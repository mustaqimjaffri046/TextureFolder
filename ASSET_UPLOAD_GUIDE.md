# Asset Upload Guide — Cloud Furniture & Material System

> Complete practical guide for uploading textures and 3D furniture models to the
> cloud so they appear in the MR/AR interior-design app on the headset.

---

## 1. Background — Why this system exists

The app is a **Mixed Reality interior-design experience** (running on Meta Quest
headsets). It lets a user walk through a real room and:

- Place 3D furniture (sofas, tables, chairs, beds, lamps, ...) into the real space.
- Change the **floor and wall materials** (wood, tile, carpet, etc.) and re-size them.

**The problem it solves:** furniture models and material textures are heavy. Shipping
them inside the headset app (APK) would make the build huge, slow, and hard to update.
The client also constantly changes the catalog (new models, new materials, prices,
labels), and pushing a new app build for every change is not practical.

**The solution — a small cloud backend:**

```
Web Dashboard  ──►  Google Apps Script API  ──►  Cloudflare R2 (file storage)
(index.html)         (Code.js)                    + Google Doc (catalog/config JSON)
```

- Files (textures, 3D models, preview images) live in a **Cloudflare R2** bucket and
  are served publicly over HTTPS to the headset.
- The **catalog structure and texture settings** (which texture maps to which size,
  tiling, prices, labels) are stored as JSON in a **Google Doc**.
- The headset app queries the Google Apps Script API, downloads the JSON, then pulls
  the actual files (textures, models, icons) from R2 **on demand**.
- Admins manage everything from a single web page (**`index.html`**, the "Furniture
  Setup" dashboard) — no app rebuild required.

### System components

| Component | File(s) | Role |
|---|---|---|
| Web dashboard | `TextureFolder/index.html` | Admin UI for uploading/editing assets |
| Backend API | `TextureFolder/Code.js` | Google Apps Script web app; saves/loads JSON, forwards uploads to R2 |
| R2 upload service | `TextureFolder/r2-upload.gs` | AWS Signature V4 upload to Cloudflare R2 |
| R2 config | `TextureFolder/r2-config.gs` | Bucket credentials + public URL |
| On-device loader | `Assets/Scripts/FloorMaterialSelector.cs`, `CatalogHierarchyRemoteLoader.cs` | Headset app downloads & renders assets |

---

## 2. Selecting a model

The model can come from **anywhere** — a paid store (Sketchfab, CGTrader, TurboSquid),
a freelancer, your own 3D software (Blender, 3ds Max), or a client-provided file.

**The one hard rule:** by the time it is uploaded, the model **must be a GLB file**
(binary glTF). The headset loads 3D models with **glTFast**, which only supports
`.glb` / `.gltf`. FBX, OBJ, STL, .blend etc. will *not* display in the app even
though the dashboard accepts them.

Recommended conversion path:

```
FBX / OBJ / .blend / Sketchfab  ──export─►  GLB (binary glTF, embedded textures)
```

---

## 3. Preparing the model before uploading

### Recommended file size

| Scope | Recommended | Hard ceiling |
|---|---|---|
| GLB upload | **≤ 10 MB** | ~30 MB (see limits below) |

Why:
- Files are sent to R2 through the Google Apps Script API, whose **payload limit is
  ~50 MB**, and base64 encoding inflates size by ~33%.
- A single `UrlFetchApp` call times out after ~100 seconds — very large files fail.
- The headset downloads models **on demand** over Wi-Fi; small files = fast placement.
- Typical existing catalog GLBs are 2–13 MB.

### Recommended polygon / vertex count (realistic Quest performance)

- **Hero furniture (sofa, bed, dining table):** 20k – 50k triangles.
- **Small furniture (chair, stool, lamp):** 5k – 20k triangles.
- **Absolute maximum per placed object:** ~75k triangles.
- **Total scene:** keep all placed furniture combined under ~250–300k triangles,
  and under ~100–150 draw calls to stay comfortably in Quest budget.

### Optimization guidelines

- **Decimate / retopologize** dense high-poly sources (Sketchfab "high" files are
  usually too heavy) down to the ranges above.
- **Delete hidden geometry** (inside faces, backfaces of closed objects, unseen
  details) before export.
- **Merge meshes / combine materials** so each model uses **1–2 draw calls**. One
  model = one material atlas texture (≤ 2048×2048) is the ideal target.
- **Bake detail to textures:** sculpted detail → normal maps; don't carry millions
  of triangles for surface bumps.
- **Embed textures in the GLB** at export (no external .bin/.png references).
- Keep texture maps **≤ 2048×2048**; 1024×1024 is plenty for most furniture on Quest.
- Prefer **GLB** over glTF (JSON + separate files) — single-file, simpler to host.
- Avoid realtime shadow-heavy setups; the app places many objects in one room.

---

## 4. Creating the preview image

Each 3D model in the catalog needs a **preview (icon) image** shown in the in-app
catalog list, and each category can have an icon too.

### Recommended image size

- **256×256 px** or **512×512 px**.
- The app's catalog thumbnails and dashboard thumbnails are square boxes; 512×512
  looks crisp while staying small (R2 serves it over the network to the headset).

### Square or other aspect ratios?

- **Square (1:1) is strongly recommended.**
- The UI uses square thumbnails and `object-fit: cover`, so **any non-square image
  gets cropped** to a square. If you must use another ratio, keep the subject
  centered with generous margins so it survives the crop.

### File format

- **PNG** (recommended) or JPG. PNG is what the system auto-generates
  (`<model>_icon.png`, `cat_<Category>.png`).

### Naming conventions

- The system **auto-names** icons: `<model name>_icon.png` and `cat_<Category>.png`,
  so you don't strictly need a convention.
- For the model itself use **descriptive, stable names** — they become the catalog
  entries: e.g. `Sofa_Modern_Black`, `Dining_Table_6_Seater`.
- The app auto-derives the display label from the file name (underscores/dashes
  become spaces): `Sofa_Modern_Black` → **"Sofa Modern Black"**.
- Avoid special characters like `<>:"/\|?*` in names — the uploader replaces them,
  which can cause surprising duplicates.

---

## 5. Uploading assets through the dashboard

### One-time setup

1. Open **`index.html`** in a browser (Chrome/Edge recommended).
2. Click the **⚙ Apps Script URL** button, paste the deployed Apps Script web app URL,
   and click **Save**. (It is stored in the browser; repeat on any new machine.)

### Texture-only assets (floor / wall materials) — e.g. flooring, tiles, wallpaper

These are pure **images** — no 3D model involved. The workflow assigns textures to
"size" slots (physical size + tiling), then pushes them to the cloud.

1. **Textures section** — drag & drop the material images into the *Drop texture
   images here* zone (or click to browse; multiple allowed). Rename each texture if
   needed.
2. **Sizes section** — click **+ Add Size** for each physical product size (e.g.
   `120 x 200`, `200 x 200`), and set **Tiling** in meters (tiles per meter, X × Y).
3. **Matrix section** — tick which textures are valid for which size. Use
   **Auto Assign by Shape** (matches square textures to square sizes) and then
   fine-tune manually.
4. Make sure the **Is Floor** checkbox matches the batch (checked = floor materials,
   unchecked = wall materials).
5. Click **Save to Google**. The dashboard uploads every texture image to R2, then
   saves the texture/size config JSON to the Google Doc. The headset app now shows
   these materials.

### Full 3D assets (sofa, table, chair, bed, ...) — model + preview image + metadata

1. Open the **Catalog Models** section (click its header to expand).
2. **Drop 3D models** into the zone, or use **Browse Folder** to add a whole folder
   (e.g. a folder of exported GLBs). Only supported extensions are added.
3. For each model:
   - Click the **icon box** on the left to set its **preview image**.
   - Confirm the **category** dropdown (auto-detected from the name; correct if wrong).
   - Optional fields: **Node ID** (auto-hashed if blank), **Display Label**,
     **Price**, **Company**, **Size**, **Description**.
   - Tick the checkbox to include it in the upload batch.
4. Click **Upload Models to Google**. The dashboard:
   - Uploads each model file to R2.
   - Uploads each preview icon to R2.
   - Uploads any category icons to R2.
   - Builds the **catalog hierarchy JSON** and saves it to the Google Doc.
   The headset app now shows the new models in the catalog and downloads them
   on demand when placed.

> **Category icons:** optional. Use the **Categories** section to add/rename
> categories and set their icons before uploading models.

---

## 6. Upload workflows by asset type (summary)

| Asset type | Examples | Files you prepare | Dashboard actions |
|---|---|---|---|
| **Texture-only** | Flooring, wall/parquet/carpet | Material images (JPG/PNG) | Textures → Sizes → Matrix → **Save to Google** |
| **Full 3D asset** | Sofa, table, chair, bed | GLB model + square preview image | Catalog Models → set icon/category/meta → **Upload Models to Google** |

---

## 7. Things to watch out for during upload

1. **Models must be GLB.** FBX/OBJ/etc. appear in the dashboard but will not load in
   the headset app (glTFast only reads GLB/glTF). Convert before uploading.
2. **Keep files small.** Big files (> ~30 MB) hit the Apps Script payload limit and
   the ~100 s upload timeout. If a model is large, decimate it first.
3. **base64 overhead.** Files travel as base64 (+~33% size); budget for it.
4. **Re-uploading overwrites by name.** Textures are merged by file name, so
   re-uploading the same name replaces the old one; renaming a texture creates a
   **duplicate** instead. Delete/rename thoughtfully.
5. **Is Floor toggles the whole batch.** If you mix floor and wall materials in one
   save, they will all be tagged the same. Save floor and wall batches separately.
6. **Apps Script URL must be set** in every browser used for uploads (stored in
   `localStorage`, not shared across machines).
7. **Node IDs should be stable.** They are auto-hashed from names; if you rename a
   model the catalog gets a new node (old one may linger in saved projects).
8. **Network dependency.** The headset app must be online at launch to fetch the
   catalog/textures; models download when placed.
9. **Security:** `r2-config.gs` currently holds **live R2 credentials in plain text.**
   For any shared/production deployment, move them into **Apps Script Script
   Properties** and never publish the dashboard publicly.

---

## 8. Can multiple assets be uploaded at the same time?

**Not today — uploads are sequential.**

The dashboard's upload loops are `for…await` (one request finishes before the next
starts), so each file takes roughly its own ~30 s and files upload one after another:
`model 1 → icon 1 → model 2 → icon 2 → …`.

**What can be done about it:**

- **Parallel uploads are technically possible** — the dashboard could fire several
  `fetch` calls at once (e.g. batches of 2–3) instead of waiting for each. This would
  cut total wall-clock time significantly.
- **Caution:** Google Apps Script throttles concurrent executions and each request
  carries boot overhead, so batching **2–4 files at a time** is a sensible target;
  uploading everything at once risks timeouts/failures and harder error handling.
- **Workaround today:** while textures/models upload, you can prepare the *next*
  batch in the same page — but only one upload batch runs at a time.

> If bulk-speed is important, the right fix is small (batched `Promise.all` in
> `saveToGoogle()` and `uploadModelsToGoogle()`), and it can be enabled in
> `index.html`.

---

## 9. End-to-end workflow — at a glance

```
        ┌──────────────────────────────────────────────────────────────────┐
        │                        CONTENT PROVIDER                          │
        │    (any source: Sketchfab, freelancer, Blender, client files)    │
        └──────────────────────────────┬───────────────────────────────────┘
                                       │
            ┌──────────────────────────┴──────────────────────────┐
            ▼                                                     ▼
   ┌──────────────────┐                                  ┌──────────────────┐
   │  TEXTURE-ONLY    │                                  │  3D MODEL        │
   │  (floor / wall)  │                                  │  (furniture)     │
   │  1. material img │                                  │  1. GLB export   │
   │  2. optimize     │                                  │  2. optimize     │
   │     (≤2048px)    │                                  │     (≤~50k tris,  │
   └────────┬─────────┘                                  │      ≤10 MB)     │
            │                                            │  3. square icon  │
            │                                            │     (256–512px)  │
            │                                            └────────┬─────────┘
            │                                                     │
            ▼                                                     ▼
   ┌─────────────────────────────────────────────────────────────────────┐
   │                    DASHBOARD  (index.html)                          │
   │   Textures ▸ Sizes ▸ Matrix      |   Catalog Models ▸ icon/meta     │
   │        │ Save to Google          |          │ Upload Models         │
   └────────┼─────────────────────────┼──────────┘                       │
            │                         │                                  │
            ▼                         ▼                                  ▼
   ┌─────────────────────────────────────────────────────────────────────┐
   │              GOOGLE APPS SCRIPT API  (Code.js)                      │
   │   uploads files ─► Cloudflare R2        saves JSON ─► Google Doc   │
   └──────────────────────────────┬──────────────────────────────────────┘
                                  │
                                  ▼
   ┌─────────────────────────────────────────────────────────────────────┐
   │                MR APP ON HEADSET (Meta Quest)                       │
   │   load textures config ─► download texture images ─► material picker│
   │   load catalog JSON ─► download icons ─► on-demand GLB download     │
   │   ─► place furniture / apply materials in the real room             │
   └─────────────────────────────────────────────────────────────────────┘
```

**One-line summary:** prepare a small, optimized GLB (+ square preview icon) or a
material image → upload through the web dashboard → files go to Cloudflare R2 and
config JSON to a Google Doc → the headset app pulls the catalog on launch and
downloads each file on demand.
