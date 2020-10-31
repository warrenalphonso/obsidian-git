# Obsidian Git
Simple plugin that allows you to backup your [Obsidian.md](https://obsidian.md) vault to a remote git repository (e.g. private repo on GitHub).

On advantages of backing up your vault with git I suggest reading this [amazing article](https://medium.com/analytics-vidhya/how-i-put-my-mind-under-version-control-24caea37b8a5) by [@tallguyjenks](https://github.com/tallguyjenks). You can find a "how-to" on git repository setup there as well, this plugin does not expose an interface to initialize git repository (yet).

Synergises well with [GitJournal](https://github.com/GitJournal/GitJournal) mobile markdown note taking app.

## How to use
With this plugin enabled, you are able to configure the following:

- Automatic vault backup every X minutes
- Pull changes from remote repository on Obsidian startup
- Assign hotkeys for pulling/pushing changes to a remote repository

## Compatibility
Custom plugins are only available for Obsidian v0.9.7+.

# Installation
## From within Obsidian
If you have Obsidian 0.9.8+, you can install this plugin from "Settings > Third Party Plugins > Obsidian Git".

## Manual installation
Download zip archive from [GitHub releases page](https://github.com/denolehov/obsidian-git/releases).
Extract the archive into `<vault>/.obsidian/plugins`.

Alternatively, using bash:
```bash
OBSIDIAN_VAULT_DIR=/path/to/your/obsidian/vault
mkdir -p $OBSIDIAN_VAULT_DIR/.obsidian/plugins
unzip ~/Downloads/obsidian-git_v1.1.0.zip -d $OBSIDIAN_VAULT_DIR/.obsidian/plugins
```

If you have any kind of feedback or questions, feel free to reach out via GitHub issues or `@evrwhr` on [Obsidian Discord server](https://discord.com/invite/veuWUTm).

---

> If you like what I do, you could consider buying me a coffee. It is unnecessary, but appreciated :) https://www.buymeacoffee.com/evrwhr
