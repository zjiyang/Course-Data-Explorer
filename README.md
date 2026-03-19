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


## Checkpoint 1 – Course Explorer Frontend

### Running the frontend (TA demo)

From the `frontend/` directory:

```bash
yarn install
yarn demo
```

---

## Checkpoint 2 - Data Insights Frontend

We added a Data Insights section to the frontend that shows three charts built from the uploaded course data. All the data comes from the backend API so there's nothing to configure manually, as long as a dataset has already been uploaded the charts will just load on their own.

### Running the frontend (TA demo)

Start the backend from the project root:

```bash
yarn start
```

Then open [http://localhost:4321](http://localhost:4321) in your browser. The Data Insights section is on the main page and loads automatically.

---

### Insight 1 - Department Average Grades (Bar Chart)

This is a horizontal bar chart showing the average grade for each department, calculated across all sections and years in the dataset. The bars are color coded so lower averages show as more red and higher averages show as more blue. You can sort alphabetically or by average, and limit the view to the top 20, top 40, or all departments.

The reason this is useful is that department heads and administrators don't always have a clear picture of how their department's grades compare to others across campus. A department with consistently low averages might have a curriculum problem, a student support gap, or just stricter grading than average. A department with unusually high averages might be worth looking at for the opposite reason. This chart makes it easy to spot those outliers at a glance without having to run queries manually.

---

### Insight 2 - Grade Trends Over Time (Line Chart)

This chart shows how the average grade in a selected department has changed from year to year. You pick a department from the dropdown and the chart updates to show the full trend across all years in the dataset. We filter out year 1900 rows (which are just overall summary entries in the raw data) so only real academic years show up.

This one is useful because a single year of data doesn't tell you much on its own. If you're an enrollment planner or curriculum lead you probably want to know whether grades in a department have been trending up or down over time, or whether there was a sudden drop in a specific year that might be worth investigating. This chart makes that kind of pattern immediately visible.

---

### Insight 3 - Grade Average vs Failure Rate (Scatter Chart)

Each dot on this chart is one course, plotted by its average grade on the X axis and its failure rate on the Y axis. The color goes from blue for low failure rates to red for high ones. You can filter by department and set a minimum enrollment cutoff so you're only looking at courses with enough students to be meaningful.

The reason we built this is that average grade alone doesn't capture how a course is going for students. A course with a 75 average but a 15% failure rate is a very different situation from one with a 68 average and almost no failures. Student advisors can use this to figure out which courses are producing the most failures and direct support resources there before students fall too far behind.