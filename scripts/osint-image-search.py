#!/usr/bin/env python3
"""
osint-image-search — person / face / reverse-image OSINT helper for HexStrike.

Real, key-free capabilities (run on infrastructure/targets you are authorized
to investigate):

  face-detect  <image>                 Detect & count faces (locations).
  face-encode  <image>                 Print a face embedding (128-d vector).
  face-compare <imageA> <imageB>       Same person? (face distance + verdict)
  reverse      <image_or_url>          Emit reverse-image search URLs for the
                                       major engines (Google Lens, Yandex, Bing,
                                       TinEye, PimEyes, FaceCheck), and attempt
                                       a key-free Yandex similar-images lookup.

Face operations use the `face_recognition` (dlib) library when available and
degrade gracefully when it is not installed. Web-wide automated face search
(PimEyes / FaceCheck) requires those paid services — this tool emits the
correct query URLs for them rather than pretending to scrape them.
"""
import json
import sys
import urllib.parse

try:
    import face_recognition  # type: ignore
    _HAS_FR = True
except Exception:
    _HAS_FR = False


def _err(msg, code=2):
    print(json.dumps({"ok": False, "error": msg}), file=sys.stderr)
    sys.exit(code)


def _require_fr():
    if not _HAS_FR:
        _err("face_recognition (dlib) is not installed in this image — face "
             "operations are unavailable; reverse-image URL generation still works.")


def cmd_face_detect(args):
    _require_fr()
    if not args:
        _err("usage: osint-image-search face-detect <image>")
    img = face_recognition.load_image_file(args[0])
    locs = face_recognition.face_locations(img)
    print(json.dumps({
        "ok": True, "image": args[0], "faces_found": len(locs),
        "locations": [{"top": t, "right": r, "bottom": b, "left": l} for (t, r, b, l) in locs],
    }, indent=2))


def cmd_face_encode(args):
    _require_fr()
    if not args:
        _err("usage: osint-image-search face-encode <image>")
    img = face_recognition.load_image_file(args[0])
    encs = face_recognition.face_encodings(img)
    if not encs:
        _err("no face found in image")
    print(json.dumps({"ok": True, "image": args[0], "encoding": [round(float(x), 6) for x in encs[0]]}))


def cmd_face_compare(args):
    _require_fr()
    if len(args) < 2:
        _err("usage: osint-image-search face-compare <imageA> <imageB>")
    a = face_recognition.face_encodings(face_recognition.load_image_file(args[0]))
    b = face_recognition.face_encodings(face_recognition.load_image_file(args[1]))
    if not a or not b:
        _err("could not find a face in one or both images")
    dist = float(face_recognition.face_distance([a[0]], b[0])[0])
    # 0.6 is the library's conventional same-person threshold.
    same = dist <= 0.6
    print(json.dumps({
        "ok": True, "imageA": args[0], "imageB": args[1],
        "face_distance": round(dist, 4), "threshold": 0.6,
        "same_person": same,
        "confidence": round(max(0.0, 1.0 - dist), 4),
    }, indent=2))


def cmd_reverse(args):
    if not args:
        _err("usage: osint-image-search reverse <image_url_or_path>")
    src = args[0]
    is_url = src.startswith("http://") or src.startswith("https://")
    enc = urllib.parse.quote(src, safe="")
    urls = {
        "google_lens": f"https://lens.google.com/uploadbyurl?url={enc}" if is_url else "https://lens.google.com/  (upload the local file)",
        "yandex": f"https://yandex.com/images/search?rpt=imageview&url={enc}" if is_url else "https://yandex.com/images/  (upload the local file)",
        "bing": f"https://www.bing.com/images/search?q=imgurl:{enc}&view=detailv2&iss=sbi" if is_url else "https://www.bing.com/visualsearch",
        "tineye": f"https://tineye.com/search?url={enc}" if is_url else "https://tineye.com/  (upload the local file)",
        "pimeyes": "https://pimeyes.com/en  (face search — paid; upload the face image)",
        "facecheck": "https://facecheck.id/  (face search — paid/credits; upload the face image)",
    }
    result = {
        "ok": True,
        "source": src,
        "source_is_url": is_url,
        "reverse_image_search": urls,
        "note": ("Web-wide automated FACE search requires PimEyes/FaceCheck (paid). "
                 "Google Lens / Yandex / Bing / TinEye do general reverse-image matching. "
                 "Open the URLs above, or upload the file in each engine when the source is a local path."),
    }

    # Best-effort, key-free Yandex similar-images lookup for URL sources.
    if is_url:
        try:
            import requests
            r = requests.get(
                "https://yandex.com/images/search",
                params={"rpt": "imageview", "url": src, "cbir_id": ""},
                headers={"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) HexStrike-OSINT"},
                timeout=15,
            )
            result["yandex_lookup_http_status"] = r.status_code
            result["yandex_lookup_hint"] = (
                "fetched Yandex result page; parse for similar images "
                "(may be rate-limited/captcha'd without a session)"
            )
        except Exception as e:
            result["yandex_lookup_error"] = str(e)[:200]

    print(json.dumps(result, indent=2))


COMMANDS = {
    "face-detect": cmd_face_detect,
    "face-encode": cmd_face_encode,
    "face-compare": cmd_face_compare,
    "reverse": cmd_reverse,
}


def main():
    if len(sys.argv) < 2 or sys.argv[1] in ("-h", "--help"):
        print(__doc__)
        print("face_recognition available:", _HAS_FR)
        sys.exit(0)
    cmd = sys.argv[1]
    if cmd not in COMMANDS:
        _err(f"unknown command '{cmd}'; one of: {', '.join(COMMANDS)}")
    COMMANDS[cmd](sys.argv[2:])


if __name__ == "__main__":
    main()
