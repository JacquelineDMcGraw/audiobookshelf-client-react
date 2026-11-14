"""Align a timed transcript with ebook words without estimating missing timestamps."""

from __future__ import annotations

from bisect import bisect_left
from difflib import SequenceMatcher
from math import isfinite
from typing import Iterable, Mapping, Sequence
from unicodedata import normalize


MAX_GAP_WORDS = 500
LINE_END_HYPHENS = ("-", "\u00ad", "\u2010")


def _key(word: str) -> str:
    # Case folding and compatibility normalization also cover PDF ligatures.
    return "".join(char for char in normalize("NFKD", word.casefold()) if char.isalnum())


def _printed_words(pages: Sequence[Sequence[str]], vocabulary: set[str]):
    words, locations = [], []
    for page, text in enumerate(pages):
        word = 0
        while word < len(text):
            value = _key(text[word])
            indexes = [(page, word)]
            if value and text[word].rstrip().endswith(LINE_END_HYPHENS) and word + 1 < len(text):
                continuation = _key(text[word + 1])
                if continuation and value + continuation in vocabulary:
                    value += continuation
                    word += 1
                    indexes.append((page, word))
            if value:
                words.append(value)
                locations.append(indexes)
            word += 1
    return words, locations


def _unique_phrases(words: list[str], length: int, candidates=None):
    phrases = {}
    for start in range(len(words) - length + 1):
        phrase = tuple(words[start : start + length])
        if candidates is None or phrase in candidates:
            phrases[phrase] = -1 if phrase in phrases else start
    return phrases


def _anchors(printed: list[str], spoken: list[str], length: int):
    """Find a monotonic chain of phrases unique in the transcript and ebook."""
    speech_phrases = _unique_phrases(spoken, length)
    candidates = _unique_phrases(printed, length, speech_phrases)
    pairs = [
        (printed_at, spoken_at)
        for phrase, spoken_at in speech_phrases.items()
        if spoken_at >= 0 and (printed_at := candidates.get(phrase, -1)) >= 0
    ]

    # Longest increasing subsequence of ebook positions. The pairs are already
    # ordered by speech position because dicts retain insertion order.
    tails, endpoints, predecessors = [], [], []
    for index, (printed_at, _) in enumerate(pairs):
        position = bisect_left(tails, printed_at)
        predecessors.append(endpoints[position - 1] if position else -1)
        if position == len(tails):
            tails.append(printed_at)
            endpoints.append(index)
        else:
            tails[position] = printed_at
            endpoints[position] = index

    chain = []
    index = endpoints[-1] if endpoints else -1
    while index >= 0:
        chain.append(pairs[index])
        index = predecessors[index]

    # Keep adjacent phrases from mapping the same word more than once.
    anchors = []
    for printed_at, spoken_at in reversed(chain):
        if not anchors or (
            printed_at >= anchors[-1][0] + length and spoken_at >= anchors[-1][1] + length
        ):
            anchors.append((printed_at, spoken_at))
    return anchors


def _gap_matches(
    printed: list[str], spoken: list[str], printed_at: int, spoken_at: int,
    *, left_anchor: bool = False, right_anchor: bool = False,
):
    if max(len(printed), len(spoken)) > MAX_GAP_WORDS:
        return
    for block in SequenceMatcher(None, printed, spoken, autojunk=False).get_matching_blocks():
        # A single common word is too weak unless it directly touches a phrase
        # anchor on both sides of the comparison.
        touches_left = left_anchor and block.a == block.b == 0
        touches_right = (
            right_anchor and block.a + block.size == len(printed)
            and block.b + block.size == len(spoken)
        )
        if block.size >= 2 or touches_left or touches_right:
            for offset in range(block.size):
                yield printed_at + block.a + offset, spoken_at + block.b + offset


def _matching_indexes(printed: list[str], spoken: list[str]):
    length = 5
    anchors = _anchors(printed, spoken, length)
    if not anchors:
        length = 3
        anchors = _anchors(printed, spoken, length)
    if not anchors:
        # A short, exact page can still align; avoid picking between repeated
        # phrases when a longer passage supplies no trustworthy anchor.
        if printed == spoken:
            yield from ((index, index) for index in range(len(printed)))
        return

    printed_at, spoken_at = 0, 0
    for index, (next_printed, next_spoken) in enumerate(anchors):
        if index == 0:
            # A sample may begin midway through a book. Search near the first
            # anchor instead of comparing all previous pages with the sample.
            printed_at = max(0, next_printed - min(MAX_GAP_WORDS, 2 * next_spoken + 16))
        yield from _gap_matches(
            printed[printed_at:next_printed], spoken[spoken_at:next_spoken],
            printed_at, spoken_at, left_anchor=index > 0, right_anchor=True,
        )
        for offset in range(length):
            yield next_printed + offset, next_spoken + offset
        printed_at, spoken_at = next_printed + length, next_spoken + length

    tail_size = min(MAX_GAP_WORDS, 2 * (len(spoken) - spoken_at) + 16)
    yield from _gap_matches(
        printed[printed_at:printed_at + tail_size], spoken[spoken_at:],
        printed_at, spoken_at, left_anchor=True,
    )


def align_words(
    pages: Sequence[Sequence[str]],
    spoken_words: Iterable[Mapping[str, str | float]],
) -> list[dict[str, int | float]]:
    """Map printed words to exact transcript times, in document and audio order.

    ``pages`` contains the extracted word strings on each ebook page, in reading
    order. ``spoken_words`` contains ``word``, ``start``, and ``end`` fields,
    with absolute times in seconds and entries ordered by start time.

    Each result has zero-based ``page`` and ``word`` indexes into the original
    ``pages``, plus ``start`` and ``end`` copied from the transcript. Unmatched
    words are omitted. Parts of a hyphenated PDF word can share one time range.
    """
    spoken, times = [], []
    for word in spoken_words:
        value = _key(str(word["word"]))
        if not value:
            continue
        start, end = float(word["start"]), float(word["end"])
        if not (isfinite(start) and isfinite(end) and 0 <= start <= end):
            raise ValueError("Transcript times must be finite and satisfy 0 <= start <= end.")
        if times and start < times[-1][0]:
            raise ValueError("Transcript words must be ordered by start time.")
        spoken.append(value)
        times.append((start, end))

    printed, locations = _printed_words(pages, set(spoken))
    return [
        {"page": page, "word": word, "start": times[heard_at][0], "end": times[heard_at][1]}
        for printed_at, heard_at in _matching_indexes(printed, spoken)
        for page, word in locations[printed_at]
    ]
