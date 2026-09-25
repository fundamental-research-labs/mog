# Website

One static page for Mog. Edit `index.html` and `style.css`. The icon is
`docs/brand/logo/mog-app-icon.svg`. Install wording stays aligned with
`docs/guides/installation.md`.

```sh
sh website/assemble.sh
python3 website/check.py
python3 -m http.server 8765 --bind 127.0.0.1 --directory website/out
```

`website/out/` is generated. Pull requests assemble and check the page.
Pushes to `main` publish it with GitHub Pages after the `github-pages`
environment approves the deployment.
