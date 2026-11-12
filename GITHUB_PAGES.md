# Publishing Iron Coffin on GitHub Pages

The Pages workflow in `.github/workflows/deploy-pages.yml` installs the game dependencies, runs the test suite, builds the standalone page, and publishes it as the site's `index.html`.

## One-time GitHub setup

1. Create a GitHub repository for this project, then push this folder to its `main` branch.
2. In the repository, open **Settings → Pages**.
3. Under **Build and deployment**, choose **GitHub Actions** as the source.
4. Open the **Actions** tab and run **Deploy GitHub Pages**, or push another commit to `main`.

When the deployment completes, GitHub displays the public site URL in the workflow summary. It will normally be `https://<account>.github.io/<repository>/`.

## What is published

Only `game/dist/iron-coffin.html` is published, renamed to `index.html`. It is a self-contained game page, so the deployed site does not need Node.js or the local `server.js` process.

The workflow deliberately excludes raw media in `assets/`, local editor state, installed dependencies, and generated `game/dist/` files from Git. The build regenerates the page from the versioned files in `game/`.

## Updating the site

Change the game source, commit it, and push to `main`. The workflow reruns tests and redeploys automatically. You can also start a deployment manually from the Actions tab.
