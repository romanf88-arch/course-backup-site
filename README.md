# Course backup site

This site turns a Canvas course export (an .imscc file) into a password-protected, read-only copy of the course on GitHub Pages. Students can keep reading course materials while Canvas is down. It also builds an Excel submission tracker that stays on your own computer.

Everything happens in a web browser. You install nothing, and your export never leaves your computer: the packing page encrypts the course before you upload it.

## Set up your site (first time only)

1. Make a free account at [github.com](https://github.com/signup) if you do not have one. Use an account that you use for nothing else, because sites on one account share a web address.
2. Click "Use this template" at the top of this page and choose "Create a new repository". Give it a short name, such as `course-backup`, choose "Public", and click "Create repository". Every course you upload is encrypted, so a public repository is safe.
3. In your new repository, click "Settings", then "Pages". Under "Build and deployment", set "Source" to "Deploy from a branch", choose the "main" branch and the "/ (root)" folder, and click "Save".
4. Wait about a minute and reload the page. GitHub shows your site's address, which looks like `https://your-name.github.io/course-backup/`.
5. Open that address and click "Pack a course".

The help page on your site (`https://your-name.github.io/course-backup/help/`) explains packing and uploading a course, sending the link to students, replacing or removing a course, the submission tracker, and size limits.

## What students see

Students see the course home page, the modules in your order, pages, files, links, and the instructions for assignments and discussions, with due dates, points, and rubrics. Quizzes show their title and instructions only.

The site leaves out quiz questions and answers, anything unpublished, locked files, and hidden files that no page links to. It holds no student records: no submissions, grades, or discussion replies.

## How it protects the course

- Each course is encrypted with AES-256-GCM. The password decrypts the course key through PBKDF2-SHA256 with 600,000 rounds.
- File names, page titles, and page text are encrypted too. Only the course title and the folder name are readable on GitHub.
- Course HTML is cleaned before it is shown, so nothing in a course can run scripts on the site.
- The submission tracker is saved only to your computer and never goes into the course folder.

## For developers

The site is plain JavaScript modules with no build step. The shared library is in `app/lib/`, the course viewer in `app/viewer/`, the packing page in `pack/`, and the service worker that decrypts files is `sw.js`.

```bash
npm install
npm test
node tools/serve.mjs
```

`npm run vendor` copies the pinned browser builds of zip.js, DOMPurify, ExcelJS, and the Atkinson Hyperlegible font into `vendor/`. `node tools/pack-local.mjs <export.imscc> <folder> --password "..."` packs a course from the command line. Tests that use real exports read their paths from `tests/fixtures.local.json`, which is not in the repository, and skip when it is missing.

## License

MIT. Third-party files in `vendor/` keep their own licenses (`vendor/licenses/`). The suggested passwords use the EFF short word list (CC BY 3.0 US, Electronic Frontier Foundation).
