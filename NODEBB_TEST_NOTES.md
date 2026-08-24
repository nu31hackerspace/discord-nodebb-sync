# NodeBB 4.15.1 validation notes

The supplied `NodeBB-4.15.1.zip` was inspected directly.

Verified against its source:

- `src/database/postgres/*` exists and `docker-compose-pgsql.yml` uses PostgreSQL.
- `User.create()` accepts `timestamp`, `picture`, and `fullname`.
- `Topics.post()` / `Topics.reply()` route through normal NodeBB bookkeeping.
- `Topics.create()` and `Posts.create()` honor supplied timestamps.
- `fromQueue: true` bypasses normal new-user/flood/content restrictions while still using NodeBB privileges and bookkeeping.
- profile images can be stored using `User.uploadCroppedPicture()`.
- files can be stored through `src/controllers/uploads.uploadFile()` and post upload associations are discovered from `/assets/uploads/files/...` links.

The supplied archive does not contain the root `package.json`; the same package manifest is present at `install/package.json`. I copied that manifest to the root for the boot attempt.

A full NodeBB boot could not be completed in this sandbox because NodeBB dependencies and a database server are not bundled in the archive, and network package installation did not complete. The plugin was therefore tested with an in-memory NodeBB API harness, and all project JavaScript was syntax-checked with Node 22.
