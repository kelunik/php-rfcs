const core = require('@actions/core');
const github = require('@actions/github');
const matter = require('gray-matter');
const { Octokit } = require('@octokit/action');

(async () => {
    try {
        console.log('Checking review...');

        if (github.context.payload.pull_request.state !== 'open') {
            console.log('Pull request is no longer open.');

            return;
        }

        if (github.context.payload.pull_request.draft) {
            console.log('Pull request is still a draft.');

            return;
        }

        const octokit = new Octokit;

        const base = github.context.payload.pull_request.base.sha;
        const head = github.context.payload.pull_request.head.sha;

        const compareUrl = github.context.payload.pull_request.base.repo.compare_url
            .replace('{base}', base)
            .replace('{head}', head);

        // https://docs.github.com/en/rest/reference/repos#compare-two-commits
        const { data } = await octokit.request('GET ' + compareUrl);

        let allowMerge = true;

        for (const file of data.files) {
            const filename = file.filename;
            const status = file.status;

            if (!filename.startsWith('rfcs/') || !filename.endsWith('.md')) {
                allowMerge = false;
                continue;
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

                const isAuthorized = fileAuthors.includes(pullRequestUser)
                    || github.context.payload.review.state === 'approved' && fileAuthors.includes(reviewer)

                if (!isAuthorized) {
                    allowMerge = false;
                    console.log(pullRequestUser + ' is not authorized for ' + filename);
                }
            }
        }

        if (allowMerge) {
            // https://docs.github.com/en/rest/reference/pulls#merge-a-pull-request
            const { data } = await octokit.request('PUT ' + github.context.payload.pull_request._links.self + '/merge', {
                sha: head,
                commit_title: 'Merge #' + github.context.payload.pull_request.number,
                merge_method: 'squash'
            });

            console.log(JSON.stringify(data));
        } else {
            console.log('Merge not allowed.');
        }
    } catch (error) {
        core.setFailed(error.message);
    }
})();