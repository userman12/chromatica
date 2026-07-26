"""Chromatica pipeline configuration.

The Met filters here were validated empirically against the Met Open Access CSV
snapshot (2026-07-25, 484,956 rows). See README for the Phase 1 findings. Three
further open-access collections were added later on the same terms -- CC0, no
API key, a public-domain flag we can trust -- and share every downstream filter.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"                    # gitignored working dir
APP = ROOT / "app"
THUMBS = APP / "thumbs"                 # committed: served by GitHub Pages
OUT_JSON = APP / "data" / "chromatica.json"

CSV_PATH = DATA / "MetObjects.csv"
CSV_URL = "https://media.githubusercontent.com/media/metmuseum/openaccess/master/MetObjects.csv"
SELECTED = DATA / "selected.json"
IMGURLS = DATA / "image_urls.jsonl"     # resumable append log
PALETTES = DATA / "palettes.jsonl"      # resumable append log

# --- sources -------------------------------------------------------------
# Every record in the pipeline is keyed by a uid of the form "{src}:{id}", and
# every thumbnail lives at app/thumbs/{src}/{id}.jpg. Ids only have to be unique
# within their own museum, which is the only guarantee any of them actually give.
#
# `url` is the public page for one object; `{}` is filled with the bare id.
# `name`/`licence` are shown verbatim in the about panel, so they are the
# attribution these collections ask for in exchange for the images.
SOURCES = {
    "met": {
        "name": "The Metropolitan Museum of Art",
        "short": "THE MET",
        "licence": "Open Access (CC0 1.0)",
        "url": "https://www.metmuseum.org/art/collection/search/{}",
        "site": "https://www.metmuseum.org/about-the-met/policies-and-documents/open-access",
    },
    "aic": {
        "name": "Art Institute of Chicago",
        "short": "THE ART INSTITUTE",
        "licence": "Public domain (CC0 1.0)",
        "url": "https://www.artic.edu/artworks/{}",
        "site": "https://api.artic.edu/docs/",
    },
    "cma": {
        "name": "Cleveland Museum of Art",
        "short": "CLEVELAND",
        "licence": "Open Access (CC0 1.0)",
        "url": "https://www.clevelandart.org/art/{}",
        "site": "https://openaccess-api.clevelandart.org/",
    },
    "nga": {
        "name": "National Gallery of Art",
        "short": "THE NATIONAL GALLERY",
        "licence": "Open Access (CC0 1.0)",
        "url": "https://www.nga.gov/artworks/{}",
        "site": "https://github.com/NationalGalleryOfArt/opendata",
    },
}
SOURCE_ORDER = ("met", "aic", "cma", "nga")

# Art Institute: one Elasticsearch query against the search endpoint. They ask
# for a contact address in AIC-User-Agent and are strict about nothing else.
AIC_SEARCH = "https://api.artic.edu/api/v1/artworks/search"
# Same Western-only boundary as DEPARTMENTS below, in the Art Institute's own
# vocabulary. Their painting set is 1,804 works of which 580 are Arts of Asia --
# a large enough share that leaving it in would quietly undo the rule.
AIC_DEPARTMENTS = [
    "Painting and Sculpture of Europe",
    "Arts of the Americas",
    "Modern Art",
    "Prints and Drawings",
]
AIC_IIIF = "https://www.artic.edu/iiif/2/{}/full/843,/0/default.jpg"
AIC_UA = "Chromatica portfolio project (real.host4you@gmail.com)"

# Cleveland: plain REST, cc0=1 does the licence filtering for us.
CMA_API = "https://openaccess-api.clevelandart.org/api/artworks/"

# Cleveland catalogues by culture rather than by department, so the Western-only
# rule (see DEPARTMENTS below) has to be spelled out as a vocabulary. Everything
# not listed here -- Mughal India, China, Japan, Korea, Tibet, Nepal, and the
# rest of their very large Asian holdings -- is left out for the same reason the
# Met's Asian Art department is: those are independent colour traditions, and a
# single chronological field would silently claim they are one.
CMA_WESTERN = {
    "america", "austria", "belgium", "britain", "byzantium", "canada",
    "denmark", "england", "flanders", "france", "germany", "greece",
    "hungary", "ireland", "italy", "netherlands", "norway", "poland",
    "portugal", "russia", "scotland", "spain", "sweden", "switzerland",
    "wales",
}

# National Gallery: bulk CSVs, no API. 00_download_csv.sh fetches these.
NGA_OBJECTS = DATA / "nga_objects.csv"
NGA_IMAGES = DATA / "nga_published_images.csv"
NGA_CONSTITUENTS = DATA / "nga_constituents.csv"
NGA_OBJ_CONSTITUENTS = DATA / "nga_objects_constituents.csv"
NGA_CSV_BASE = "https://raw.githubusercontent.com/NationalGalleryOfArt/opendata/main/data/"
# maxpixels is honoured by their IIIF server; 843 matches what AIC serves.
NGA_IIIF = "https://api.nga.gov/iiif/{}/full/!843,843/0/default.jpg"

# --- selection filters (Phase 1 validated) -------------------------------
# Western painting traditions only. Asian/Islamic Art are excluded: mixing them
# into one chronological grid would conflate independent colour traditions.
DEPARTMENTS = {
    "European Paintings",
    "The American Wing",
    "Robert Lehman Collection",
    "The Cloisters",
    "European Sculpture and Decorative Arts",
    "Modern and Contemporary Art",
    "Medieval Art",
}

# Portrait miniatures on ivory are excluded: their palette is dominated by the
# ivory ground and flesh tones, which would systematically skew 1790-1840.
EXCLUDE_MEDIUM = ("ivory",)

YEAR_MIN, YEAR_MAX = 1300, 1910         # public domain effectively ends ~1910
MAX_DATE_SPAN = 25                      # objectEndDate - objectBeginDate

# --- colour extraction ---------------------------------------------------
KMEANS_K = 5                            # clusters requested per painting
PALETTE_MAX = 5                         # colours kept after dedup
PALETTE_MIN = 3
ANALYSIS_PX = 160                       # long edge for k-means input
# The detail card shows the work at 300 CSS px, so 600 device px on a retina
# screen. This is deliberately set just above what the sources carry: across all
# 2,555 works the long edge came out 596-625 (median 624), so nothing was
# upscaled and nothing was thrown away -- thumbnail() only ever shrinks. Raising
# this further would change nothing; the Met's web-size ceiling is the real limit.
THUMB_PX = 640                          # long edge for committed thumbnail

# WebP rather than JPEG, because these files are committed and served, and the
# collection is now 7,094 works: format is the one lever that trades nothing.
# Measured over 24 works at 640px, against the uncompressed LANCZOS resize,
# with 8x8 windowed SSIM:
#
#     JPEG q74   40.7 KB   mean 0.9477   worst 0.9188
#     WebP q80   34.6 KB   mean 0.9537   worst 0.9188
#
# q80 is where WebP stops losing to JPEG in the worst block, not merely on
# average -- below it (q76: worst 0.9058) it is measurably softer, so the 30%
# saving the format is usually quoted for is not actually free here. This is
# 15% smaller at strictly-no-worse fidelity, and it is chosen now rather than
# later because thumbnails are committed: re-rendering the set in a year would
# leave both copies in git history forever.
THUMB_FORMAT = "WEBP"
THUMB_EXT = "webp"
THUMB_QUALITY = 80
THUMB_METHOD = 6                        # slowest/densest encoder search
THUMBS_LOG = DATA / "thumbs.jsonl"      # resumable append log for 05_thumbs.py
MIN_CLUSTER_SHARE = 0.04                # drop clusters below 4% of pixels
DEDUP_DISTANCE = 26                     # euclidean RGB distance for dedup

# Many Met object photos (small panels, shaped altarpieces, irregular supports)
# are shot against a uniform neutral studio backdrop. Left in, that backdrop
# injects fake grey cells and breaks the premise that every cell is a real
# colour from a real painting. Detected via border-ring uniformity, then removed.
# ~7.5% of Met painting images are black-and-white photographs (filenames carry
# a ".bw." marker). In a piece about colour they are poison: they contribute a
# fake neutral grey ramp. Measured separation is unambiguous -- true B&W scans
# have mean chroma of exactly 0.0, while the lowest colour reproduction measured
# 13.6 -- so these paintings are dropped from the dataset entirely.
GRAYSCALE_MAX_CHROMA = 4.0

# Detection keys on what a seamless studio backdrop actually is -- near-neutral
# (R~=G~=B) and light -- rather than on strict uniformity, because the backdrop
# is usually vignetted. This deliberately will NOT strip a painting's own dark
# background (fails the lightness test), which is real content.
BACKDROP_RING = 0.03                    # fraction of the edge sampled as "ring"
BACKDROP_UNIFORM_DIST = 45              # ring pixel counts as "same" within this
BACKDROP_UNIFORM_FRAC = 0.55            # ring is a backdrop above this fraction
BACKDROP_MAX_CHROMA = 12                # max(RGB)-min(RGB) to count as neutral
BACKDROP_MIN_LIGHTNESS = 140            # mean RGB floor; darks are real paint
BACKDROP_TOLERANCE = 45                 # remove pixels within this of backdrop
BACKDROP_MAX_REMOVED = 0.75             # abort removal if it would eat this much

# --- adaptive binning ----------------------------------------------------
# Coverage is wildly uneven (4 paintings in the 1350s vs 245 in the 1870s), so
# bins hold a roughly constant number of works instead of a fixed year span.
TARGET_PER_BIN = 60

# --- network -------------------------------------------------------------
# The Met API rejects bursts hard: 4 concurrent workers lost 83% of requests to
# HTTP 403. Measured sustainable ceiling is ~4-5 req/s with 2 workers.
USER_AGENT = "Chromatica/0.1 (portfolio data-art project; +https://github.com/userman12/chromatica)"
API_WORKERS = 2
API_MIN_INTERVAL = 0.22                 # seconds between API requests (global)
IMG_WORKERS = 4                         # images.metmuseum.org tolerates more
IMG_MIN_INTERVAL = 0.06
MAX_RETRIES = 5
API_BASE = "https://collectionapi.metmuseum.org/public/collection/v1/objects/"
MET_OBJECT_URL = "https://www.metmuseum.org/art/collection/search/{}"
