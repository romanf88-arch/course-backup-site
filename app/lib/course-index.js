// The index.html written into every packed course folder. It holds no
// course content; it only loads the shared viewer from the site's app/ folder.
export const COURSE_INDEX_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Course</title>
<link rel="stylesheet" href="../app/styles.css">
<script type="module" src="../app/viewer/main.js"></script>
</head>
<body>
<div id="app" class="app-loading">
<noscript>This course needs JavaScript. Turn it on in your browser settings, then reload the page.</noscript>
</div>
</body>
</html>
`;
