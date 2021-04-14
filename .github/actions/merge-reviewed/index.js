const core = require('@actions/core');
const github = require('@actions/github');
const matter = require('gray-matter');
const Octokit = require('@octokit/action');

(async () => {
    try {
        console.log('Checking review...');

        const octokit = new Octokit;

        const base = github.context.payload.pull_request.base.sha;
        const head = github.context.payload.pull_request.head.sha;

        const compareUrl = github.context.payload.pull_request.base.repo.compare_url
            .replace('{base}', base)
            .replace('{head}', head);

        // https://docs.github.com/en/rest/reference/repos#compare-two-commits
        const { data } = await octokit.request('GET ' + compareUrl);

        for (const file of data.files) {
            const filename = file.filename;
            const status = file.status;

            if (!filename.startsWith('rfcs/') || !filename.endsWith('.md')) {
                // Don't auto-merge non-rfcs
                // TODO: Don't error but succeed without action
                throw new Error("Auto-merge is only enabled for RFCs");
            }

            if (status !== 'added') {
                console.log(filename + ' ' + status + ', checking authorization...');

                // We're at the base, so this reads the original file
                const fileData = matter.read(filename, {
                    language: 'yaml'
                });

                const fileAuthors = fileData.data.authors || [];
                const pullRequestUser = github.context.payload.pull_request.user.login;
                const reviewer = github.context.payload.review.user.login;

                if (!fileAuthors.includes(pullRequestUser)) {
                    console.log(pullRequestUser + ' is not an author of ' + filename);
                }

                if (github.context.payload.review.state === 'approved' && !fileAuthors.includes(reviewer)) {
                    console.log(reviewer + ' is not an author of ' + filename);
                }
            }
        }
    } catch (error) {
        core.setFailed(error.message);
    }
})();