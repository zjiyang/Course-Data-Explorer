# CPSC 310 Project Repository

This repository contains starter code for the class project.
Please keep your repository private.

For information about the project, autotest, and the checkpoints, see the course webpage.

## Configuring your environment

To start using this project, you need to get your development environment configured so that you can build and execute the code.
To do this, follow these steps; the specifics of each step will vary based on your operating system:

1. [Install git](https://git-scm.com/downloads) (v2.X). You should be able to execute `git --version` on the command line after installation is complete.

1. [Install Node (Current)](https://nodejs.org/en/download/) (Current: v24.X), which will also install NPM (you should be able to execute `node --version` and `npm --version` on the command line).

1. [Install Yarn](https://yarnpkg.com/en/docs/install) (1.22.X). You should be able to execute `yarn --version`.

1. Clone your repository by running `git clone REPO_URL` from the command line. You can get the REPO_URL by clicking on the green button on your project repository page on GitHub. Note that due to new department changes you can no longer access private git resources using https and a username and password. You will need to use either [an access token](https://help.github.com/en/github/authenticating-to-github/creating-a-personal-access-token-for-the-command-line) or [SSH](https://help.github.com/en/github/authenticating-to-github/adding-a-new-ssh-key-to-your-github-account).

## Project commands

Once your environment is configured you need to further prepare the project's tooling and dependencies.

In a terminal, navigate to your project directory (where you cloned this repo) and run:

1. `yarn install` to download the packages specified in your project's *package.json* to the *node_modules* directory. You should only need to run this command once after cloning your repo.

1. `yarn build` to compile your project and check for formatting issues. You must run this command after making changes to your TypeScript files. If your project does not compile, or has formatting issues, it will not be accepted by AutoTest. Most formatting issues can be fixed automatically by running `yarn prettier:fix`.

1. `yarn test` to run the test suite.
    - To also generate a coverage report, run `yarn cover`.

Optional: enable linting by removing the `.disabled` extension from the `eslint.config.mjs.disabled` filename, and using the `yarn build:lint` command instead of the `yarn build` command. The `yarn lint:check` command will inform you of lint errors in your code, some of which you may be able to automatically fix using the `yarn lint:fix` command.

If you are curious, some of these commands are actually shortcuts defined in [package.json -> scripts](./package.json).

## Running and testing from an IDE

IntelliJ Ultimate should be automatically configured the first time you open the project (IntelliJ Ultimate is a free download through the [JetBrains student program](https://www.jetbrains.com/community/education/#students/)).

### License

Licensing terms are specified in [LICENSE](LICENSE).
