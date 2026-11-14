"""Turn an EPUB spine into text pages without opening external resources."""

from html.parser import HTMLParser
import os
import posixpath
from urllib.parse import unquote, urlsplit
from xml.etree import ElementTree
from zipfile import BadZipFile, ZipFile


EPUB_ENTRY_BYTES = 8 * 1024 * 1024
EPUB_ARCHIVE_BYTES = 512 * 1024 * 1024
EPUB_TEXT_BYTES = 64 * 1024 * 1024
EPUB_ENTRY_LIMIT = 4096
EPUB_PAGE_WORDS = 350
HTML_MEDIA_TYPES = {'application/xhtml+xml', 'text/html'}
HTML_HEADINGS = {'h1', 'h2', 'h3', 'h4', 'h5', 'h6'}
HTML_BLOCKS = HTML_HEADINGS | {
    'article', 'aside', 'blockquote', 'dd', 'div', 'dl', 'dt', 'figcaption', 'footer',
    'header', 'li', 'main', 'ol', 'p', 'pre', 'section', 'table', 'td', 'th', 'tr', 'ul',
}
HTML_SKIP = {'head', 'nav', 'script', 'style', 'svg', 'template'}
HTML_VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'wbr'}


def _member_path(base, href):
    url = urlsplit(href)
    path = unquote(url.path)
    if url.scheme or url.netloc or not path or path.startswith('/') or '\\' in path or '\x00' in path:
        raise ValueError('EPUB resources must be local archive paths.')
    resolved = posixpath.normpath(posixpath.join(posixpath.dirname(base), path))
    if resolved == '..' or resolved.startswith('../'):
        raise ValueError('EPUB resource path leaves the archive.')
    return resolved


class _EpubArchive:
    def __init__(self, archive):
        self.archive = archive
        members = archive.infolist()
        if len(members) > EPUB_ENTRY_LIMIT or len({info.filename for info in members}) != len(members):
            raise ValueError('EPUB contains too many resources or ambiguous resource names.')
        self.remaining = EPUB_TEXT_BYTES
        self.encrypted = set()
        if 'META-INF/encryption.xml' in archive.NameToInfo:
            encryption = self.xml('META-INF/encryption.xml')
            for reference in encryption.iterfind('.//{*}CipherReference'):
                self.encrypted.add(_member_path('', reference.get('URI', '')))

    def read(self, path):
        try:
            info = self.archive.getinfo(path)
        except KeyError as exc:
            raise ValueError('EPUB is missing a required resource.') from exc
        if info.flag_bits & 1 or path in self.encrypted:
            raise ValueError('This EPUB has encrypted resources.')
        limit = min(EPUB_ENTRY_BYTES, self.remaining)
        if info.file_size > limit:
            raise ValueError('EPUB text exceeds the supported size.')
        with self.archive.open(info) as stream:
            data = stream.read(limit + 1)
        if len(data) > limit:
            raise ValueError('EPUB text exceeds the supported size.')
        self.remaining -= len(data)
        return data

    def xml(self, path):
        data = self.read(path)
        if b'<!ENTITY' in data.replace(b'\0', b'').upper():
            raise ValueError('EPUB metadata declares unsupported XML entities.')
        return ElementTree.fromstring(data)


class _TextParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.blocks = []
        self.parts = []
        self.heading = None
        self.hidden = []

    def flush(self):
        text = ' '.join(''.join(self.parts).split())
        if text:
            self.blocks.append((text, self.heading is not None))
        self.parts.clear()

    def handle_starttag(self, tag, attrs):
        if self.hidden:
            if tag not in HTML_VOID:
                self.hidden.append(tag)
            return
        attributes = dict(attrs)
        if tag in HTML_SKIP or 'hidden' in attributes or attributes.get('aria-hidden') == 'true':
            if tag not in HTML_VOID:
                self.hidden.append(tag)
            return
        if tag in HTML_BLOCKS:
            self.flush()
        if tag in HTML_HEADINGS:
            self.heading = tag
        if tag in {'br', 'hr'}:
            self.parts.append(' ')

    def handle_endtag(self, tag):
        if self.hidden:
            if tag in self.hidden:
                while self.hidden.pop() != tag:
                    pass
            return
        if tag in HTML_BLOCKS:
            self.flush()
        if tag == self.heading:
            self.heading = None

    def handle_data(self, data):
        if not self.hidden:
            self.parts.append(data)


class _NavigationParser(HTMLParser):
    def __init__(self, path):
        super().__init__(convert_charrefs=True)
        self.path = path
        self.in_contents = False
        self.href = None
        self.parts = []
        self.labels = {}

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if tag == 'nav' and ('toc' in (attributes.get('epub:type') or '').split() or attributes.get('role') == 'doc-toc'):
            self.in_contents = True
        if self.in_contents and tag == 'a':
            self.href = attributes.get('href')
            self.parts.clear()

    def handle_data(self, data):
        if self.href:
            self.parts.append(data)

    def handle_endtag(self, tag):
        if tag == 'a' and self.href:
            label = ' '.join(''.join(self.parts).split())
            try:
                target = _member_path(self.path, self.href)
            except ValueError:
                target = None
            if target and label:
                self.labels.setdefault(target, label[:180])
            self.href = None
        if tag == 'nav':
            self.in_contents = False


def _read_html(data):
    if data.startswith((b'\xff\xfe', b'\xfe\xff')):
        return data.decode('utf-16')
    return data.decode('utf-8-sig')


def _navigation_labels(archive, package_path, manifest, spine):
    nav = next((entry for entry in manifest.values() if 'nav' in entry.get('properties', '').split()), None)
    if nav is not None:
        path = _member_path(package_path, nav.get('href', ''))
        parser = _NavigationParser(path)
        parser.feed(_read_html(archive.read(path)))
        parser.close()
        return parser.labels
    toc = manifest.get(spine.get('toc'))
    if toc is None:
        return {}
    path = _member_path(package_path, toc.get('href', ''))
    labels = {}
    for point in archive.xml(path).iterfind('.//{*}navPoint'):
        content = point.find('./{*}content')
        label = point.findtext('./{*}navLabel/{*}text', '').strip()
        if content is not None and label:
            try:
                target = _member_path(path, content.get('src', ''))
            except ValueError:
                continue
            labels.setdefault(target, label[:180])
    return labels


def _append_text_pages(pages, blocks, section_title):
    words = []
    chapter = section_title

    def flush():
        nonlocal words, chapter
        if not words:
            return
        page = {'number': len(pages) + 1, 'words': words}
        if chapter:
            page['chapter'] = chapter
        pages.append(page)
        words, chapter = [], None

    for text, heading in blocks:
        if heading:
            flush()
            chapter = chapter or text[:180]
        parts = text.split()
        if len(words) >= EPUB_PAGE_WORDS // 2 and len(words) + len(parts) > EPUB_PAGE_WORDS:
            flush()
        for i, part in enumerate(parts):
            if len(words) == EPUB_PAGE_WORDS:
                flush()
            word = {'text': part}
            if i == 0 and words:
                word['breakBefore'] = 'paragraph'
            words.append(word)
    flush()


def read_epub(path):
    """Extract primary EPUB content in spine order without rendering HTML or fetching resources."""
    pages = []
    if isinstance(path, (str, bytes, os.PathLike)) and os.stat(path).st_size > EPUB_ARCHIVE_BYTES:
        raise ValueError('EPUB archive exceeds the supported size.')
    try:
        with ZipFile(path) as zip_file:
            archive = _EpubArchive(zip_file)
            container = archive.xml('META-INF/container.xml')
            rootfile = container.find('./{*}rootfiles/{*}rootfile')
            if rootfile is None:
                raise ValueError('EPUB does not declare a package document.')
            package_path = _member_path('', rootfile.get('full-path', ''))
            package = archive.xml(package_path)
            spine = package.find('./{*}spine')
            if spine is None:
                raise ValueError('EPUB has no reading order.')
            manifest = {entry.get('id'): entry for entry in package.iterfind('./{*}manifest/{*}item')}
            labels = _navigation_labels(archive, package_path, manifest, spine)
            for reference in spine.iterfind('./{*}itemref'):
                entry = manifest.get(reference.get('idref'))
                if entry is None:
                    raise ValueError('EPUB reading order references a missing resource.')
                if (reference.get('linear') == 'no' or entry.get('media-type') not in HTML_MEDIA_TYPES
                        or 'nav' in entry.get('properties', '').split()):
                    continue
                resource = _member_path(package_path, entry.get('href', ''))
                parser = _TextParser()
                parser.feed(_read_html(archive.read(resource)))
                parser.close()
                parser.flush()
                _append_text_pages(pages, parser.blocks, labels.get(resource))
    except (BadZipFile, ElementTree.ParseError, UnicodeError) as exc:
        raise ValueError('EPUB could not be read as a text publication.') from exc
    if not pages:
        raise ValueError('EPUB has no selectable text in its reading order.')
    return pages
