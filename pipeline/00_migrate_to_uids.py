"""One-shot — move the Met-only working state onto the namespaced layout.

Before four collections existed, every id in this pipeline was a bare Met object
id and every thumbnail sat at app/thumbs/{id}.jpg. Ids are only unique within a
museum, so both had to change: records are keyed "met:436535" and thumbnails
live at app/thumbs/met/436535.jpg.

This exists so that switch costs nothing. The three append logs are rewritten in
place and the 2,555 committed thumbnails are moved with `git mv`, which means no
Met image is downloaded again and no palette is measured again -- ~2,555 images
and several hours of k-means that are already correct.

Idempotent: a log that is already keyed by uid, and a thumbnail already inside
its source directory, are left alone. Safe to run twice; pointless to run twice.
"""
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import config as C

LOGS = (C.IMGURLS, C.PALETTES, C.THUMBS_LOG)


def migrate_log(path):
    if not path.exists():
        return "absent"
    lines = [l for l in path.read_text().splitlines() if l.strip()]
    out, changed = [], 0
    for line in lines:
        rec = json.loads(line)
        if "uid" not in rec:
            rec = {"uid": f"met:{rec.pop('id')}", **rec}
            changed += 1
        out.append(json.dumps(rec, ensure_ascii=False))
    path.write_text("\n".join(out) + "\n")
    return f"{changed}/{len(lines)} rekeyed"


def migrate_thumbs():
    loose = sorted(C.THUMBS.glob("*.jpg"))
    if not loose:
        return "nothing to move"
    dest = C.THUMBS / "met"
    dest.mkdir(parents=True, exist_ok=True)
    # git mv in one call: 2,555 separate invocations would take minutes, and a
    # partial move would leave the tree in a state neither script understands.
    tracked = subprocess.run(
        ["git", "-C", str(C.ROOT), "ls-files", "--error-unmatch", "--",
         *(str(p.relative_to(C.ROOT)) for p in loose)],
        capture_output=True, text=True)
    if tracked.returncode == 0:
        subprocess.run(["git", "-C", str(C.ROOT), "mv",
                        *(str(p.relative_to(C.ROOT)) for p in loose),
                        str(dest.relative_to(C.ROOT))], check=True)
    else:
        for p in loose:                      # untracked: a plain rename is fine
            p.rename(dest / p.name)
    return f"{len(loose)} thumbnails -> thumbs/met/"


def main():
    for path in LOGS:
        print(f"{path.name:<20} {migrate_log(path)}")
    print(f"{'app/thumbs':<20} {migrate_thumbs()}")


if __name__ == "__main__":
    main()
