"""Rijksmuseum — OAI-PMH harvest of the museum's own "Top 1000".

Why this source, and why only a thousand of it
----------------------------------------------
The other four collections are American, and it shows: measured against a list
of canonical Western painters, the field held four Leonardos, two van Eycks,
two Bruegels and nine Vermeers, while George Catlin alone accounted for 351
works. The Dutch and Flemish seventeenth century -- the stretch where the chroma
curve reaches its lowest point, which is the piece's own argument -- was being
read off whatever New York, Washington, Chicago and Cleveland happen to own.

The Rijksmuseum is the obvious correction, and it is taken here at its own
estimate of itself: set 260214, the curated "Top 1000". That is a deliberate
narrowing, not a shortcut. Harvesting every Rijksmuseum painting would add some
three thousand works and around ninety megabytes of committed thumbnails to a
repository already carrying 249 MB, most of it to deepen a corner of the field
that is about to be well covered anyway. The Top 1000 yields 400 paintings, all
of them already public domain, for roughly 14 MB -- and they are the ones the
museum itself considers worth seeing.

The API question
----------------
Every tutorial still points at `www.rijksmuseum.nl/api/en/collection`. That
endpoint is retired -- it answers 410 Gone -- and its replacement requires a
registered key, which would have made this the first source in the project to
need a credential. OAI-PMH does not: `data.rijksmuseum.nl/oai` is open, and so
is the Linked Art resolver behind `id.rijksmuseum.nl` that this module uses to
turn a creator into a nationality. So the "CC0, no API key" rule the other four
sources were chosen under survives intact.

Two harvests, because neither format is sufficient alone
--------------------------------------------------------
`oai_dc` carries the creator as a literal name, the date, and the object type.
`edm` carries the IIIF image URL and the creator as a URI -- and the URI is what
makes the nationality resolvable. Both are harvested over the same set and
joined on the record identifier; 21 pages each, which is cheaper than resolving
a thousand objects one at a time.
"""
import collections
import json
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import config as C  # noqa: E402
from sources import make  # noqa: E402

KEY = "rijks"

NS = {
    "oai": "http://www.openarchives.org/OAI/2.0/",
    "dc": "http://purl.org/dc/elements/1.1/",
    "dcterms": "http://purl.org/dc/terms/",
    "edm": "http://www.europeana.eu/schemas/edm/",
    "rdf": "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
}
RDF_RESOURCE = f"{{{NS['rdf']}}}resource"


def _fetch(params):
    url = f"{C.RIJKS_OAI}?{urllib.parse.urlencode(params)}"
    for attempt in range(C.MAX_RETRIES):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": C.USER_AGENT})
            with urllib.request.urlopen(req, timeout=90) as resp:
                return ET.fromstring(resp.read())
        except Exception:
            if attempt == C.MAX_RETRIES - 1:
                raise
            time.sleep(2 ** attempt)


def harvest(setspec, prefix):
    """Every record of one set in one metadata format, keyed by identifier.

    OAI-PMH pages with an opaque resumption token rather than an offset, so this
    has to be a loop and cannot be parallelised. Fifty records a page.
    """
    out = {}
    params = {"verb": "ListRecords", "metadataPrefix": prefix, "set": setspec}
    while True:
        root = _fetch(params)
        error = root.find(".//oai:error", NS)
        if error is not None:
            raise RuntimeError(f"OAI-PMH {error.get('code')}: {error.text}")
        for record in root.findall(".//oai:record", NS):
            ident = record.findtext(".//oai:identifier", "", NS).rsplit("/", 1)[-1]
            if ident:
                out[ident] = record
        token = root.find(".//oai:resumptionToken", NS)
        if token is None or not (token.text or "").strip():
            return out
        params = {"verb": "ListRecords", "resumptionToken": token.text.strip()}
        time.sleep(C.API_MIN_INTERVAL)


# --- dates ---------------------------------------------------------------
# The Rijksmuseum writes twelve different date shapes in this set alone:
# "1642", "1482 - 1485", "ca. 1665 - ca. 1670", "na 1648", "voor 1652". The
# qualifiers are Dutch and they are all hedges -- circa, after, before -- which
# is information the shared date rule already expresses better: a hedge widens
# the begin/end span, and a span wider than MAX_DATE_SPAN is rejected for every
# source alike. So they are stripped and the years themselves are what is read.
_HEDGES = ("ca.", "c.", "circa", "in of na", "na", "voor", "vermoedelijk")


def parse_date(raw):
    """(begin, end) from a Rijksmuseum date string, or None."""
    if not raw:
        return None
    text = raw.lower()
    for hedge in _HEDGES:
        text = text.replace(hedge, " ")
    years = [int(y) for y in __import__("re").findall(r"\b(\d{3,4})\b", text)]
    if not years:
        return None
    return min(years), max(years)


# --- nationality ---------------------------------------------------------
# The SCHOOL filter is one vocabulary shared by every source, so a Rijksmuseum
# painter has to arrive as the same demonym the other four already use. The
# literal name in oai_dc carries no nationality at all; the Linked Art record
# behind the creator URI does, as a `classified_as` entry that is itself
# classified as AAT "nationality".
#
# Note that this is not the AAT code an educated guess lands on: 300055147,
# which reads like it should be nationality, resolves to gender ("male"), and
# using it would have labelled every Dutch painter's school as their sex. It is
# 300379842, established by resolving a known artist and reading both.
_cache = {}

# The Rijksmuseum answers in two languages and in region names where the other
# four catalogues answer in demonyms: "North Netherlandish", "Zuid-Nederlands",
# "Engels", "Belgisch". Left alone those become four new entries in the SCHOOL
# filter sitting beside the ones that mean the same thing, so they are folded
# into the vocabulary the other sources already established.
SCHOOL = {
    "north netherlandish": "Netherlandish",   # split by date below
    "noord-nederlands": "Netherlandish",
    "zuid-nederlands": "Flemish",
    "south netherlandish": "Flemish",
    "nederlands": "Dutch", "dutch": "Dutch",
    "vlaams": "Flemish", "flemish": "Flemish",
    "engels": "British", "english": "British", "british": "British",
    "brits": "British", "schots": "British", "scottish": "British",
    "frans": "French", "french": "French",
    "duits": "German", "german": "German",
    "italiaans": "Italian", "italian": "Italian",
    "spaans": "Spanish", "spanish": "Spanish",
    "vlaams-belgisch": "Belgian", "belgisch": "Belgian", "belgian": "Belgian",
    "amerikaans": "American", "american": "American",
    "zwitsers": "Swiss", "swiss": "Swiss",
    "oostenrijks": "Austrian", "austrian": "Austrian",
    "unknown": "", "onbekend": "",
}
# The one case a lookup cannot settle, because the split is temporal and not
# geographic: the same region is Netherlandish before the revolt and Dutch
# after it, and both terms are already in the vocabulary. 1580 is where the
# other catalogues put the line, so it is where this one puts it too --
# see sources/cma.py, which had to make the identical decision.
NETHERLANDISH_UNTIL = 1580


def school_of(raw, year):
    """Fold the Rijksmuseum's answer into the shared SCHOOL vocabulary."""
    mapped = SCHOOL.get((raw or "").strip().lower(), (raw or "").strip())
    if mapped == "Netherlandish" and year and year >= NETHERLANDISH_UNTIL:
        return "Dutch"
    return mapped


def _linked_art(uri):
    req = urllib.request.Request(
        uri, headers={"User-Agent": C.USER_AGENT, "Accept": "application/ld+json"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.load(resp)


def _label(uri):
    if uri in _cache:
        return _cache[uri]
    try:
        doc = _linked_art(uri)
    except Exception:
        _cache[uri] = ""
        return ""
    name = ""
    for entry in doc.get("identified_by", []):
        if entry.get("type") == "Name" and entry.get("content"):
            name = entry["content"]
            break
    _cache[uri] = name or doc.get("_label") or ""
    return _cache[uri]


def nationality_of(creator_uri):
    """The painter's school, or "" when the catalogue does not say.

    Two hops and both are cached: this set has about 250 distinct painters and
    a dozen distinct nationalities between them, so the second hop is answered
    from memory almost every time. An empty string is a real answer -- it lands
    the work in "Other / unattributed" -- and is very much better than guessing
    "Dutch" because the museum is in Amsterdam.
    """
    if not creator_uri:
        return ""
    if creator_uri in _cache:
        return _cache[creator_uri]
    try:
        doc = _linked_art(creator_uri)
    except Exception:
        _cache[creator_uri] = ""
        return ""
    found = ""
    for classification in doc.get("classified_as", []):
        kinds = [k.get("id") for k in classification.get("classified_as", [])]
        if C.RIJKS_NATIONALITY_AAT in kinds:
            found = _label(classification["id"])
            break
    _cache[creator_uri] = found
    return found


# --- images --------------------------------------------------------------
def iiif_url(raw):
    """Rewrite the advertised image URL to the size this project measures.

    `edm:isShownBy` points at `.../full/max/0/default.jpg`, which for a Rijks
    painting is a 6.4 MB, 7964px scan. The server is IIIF level 2, so the size
    segment can simply be replaced -- the same `!843,843` the National Gallery
    adapter asks for, which lands around 90 KB.
    """
    if not raw:
        return None
    parts = raw.rsplit("/", 4)
    if len(parts) != 5:
        return raw
    base, _region, _size, rotation, quality = parts
    return f"{base}/full/{C.RIJKS_IIIF_SIZE}/{rotation}/{quality}"


def select(stats=None):
    stats = stats if stats is not None else collections.Counter()

    dublin = harvest(C.RIJKS_SET, "oai_dc")
    europeana = harvest(C.RIJKS_SET, "edm")
    stats["rows"] = len(dublin)

    out = []
    for ident, record in dublin.items():
        def texts(tag, prefix="dc"):
            return [e.text for e in record.findall(f".//{prefix}:{tag}", NS) if e.text]

        # The set is the museum's "Top 1000" across the whole collection, so it
        # carries furniture, prints, sculpture and Delftware as well. Only the
        # paintings are wanted, and the type field says so in one word.
        types = [t.lower() for t in texts("type")]
        if not any(C.RIJKS_TYPE in t for t in types):
            stats["drop_not_painting"] += 1
            continue

        # Belt and braces on the licence. The whole set happens to be public
        # domain today, but that is an observation about this harvest, not a
        # guarantee, and the piece's premise is that every image is free.
        rights = " ".join(texts("rights"))
        if "publicdomain" not in rights:
            stats["drop_rights"] += 1
            continue

        aggregate = europeana.get(ident)
        img = creator_uri = None
        english = ""
        if aggregate is not None:
            shown = aggregate.find(".//edm:isShownBy", NS)
            if shown is not None:
                img = iiif_url(shown.get(RDF_RESOURCE))
            creator = aggregate.find(".//dc:creator", NS)
            if creator is not None:
                creator_uri = creator.get(RDF_RESOURCE)
            # oai_dc collapses the languages and hands back whichever title
            # comes first, which is the Dutch one -- so the field would have
            # carried "De Nachtwacht" and "De aanbidding der koningen" among
            # four collections that catalogue in English. edm keeps them
            # apart, and the museum supplies both.
            for node in aggregate.findall(".//dc:title", NS):
                if node.get("{http://www.w3.org/XML/1998/namespace}lang") == "en" and node.text:
                    english = node.text
                    break
        if not img:
            stats["drop_no_image"] += 1
            continue

        dated = parse_date((texts("date") or [""])[0])
        if dated is None:
            stats["drop_no_date"] += 1
            continue
        begin, end = dated

        names = texts("creator")
        # "anoniem" is the catalogue saying it does not know, in Dutch. Left
        # alone it would arrive as an artist named Anoniem with a dozen works.
        artist = "" if not names or names[0].strip().lower() == "anoniem" else names[0]

        titles = texts("title")
        title = english or (titles[0] if titles else "")
        if not english:
            stats["title_dutch_only"] += 1
        school = school_of(nationality_of(creator_uri), (begin + end) // 2) if artist else ""
        rec = make(KEY, ident, title, artist, school, begin, end,
                   " ".join(types), img=img)
        if rec is None:
            stats["drop_date_or_medium"] += 1
            continue
        out.append(rec)

    stats["nationality_resolved"] = sum(1 for v in _cache.values() if v)
    return out
