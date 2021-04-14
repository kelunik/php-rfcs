const core = require('@actions/core');
const github = require('@actions/github');
const matter = require('gray-matter');
const { Octokit } = require('@octokit/action');

(async () => {
    try {
        console.log('Checking pull request...');

        const octokit = new Octokit;

        const owner = github.context.payload.repository.owner.login;
        const repository = github.context.payload.repository.name;
        const number = Number(core.getInput('PULL_REQUEST_NUMBER', { required: true }));

        const { pullRequest } = await octokit.request('GET /repos/' + owner + '/' + repository + '/pulls/' + number);
        const { pullRequestReviews } = await octokit.request('GET /repos/' + owner + '/' + repository + '/pulls/' + number + '/reviews');

        if (pullRequest.state !== 'open') {
            console.log('Pull request is no longer open.');

            return;
        }

        if (pullRequest.draft) {
            console.log('Pull request is still a draft.');

            return;
        }

        const base = pullRequest.base.sha;
        const head = pullRequest.head.sha;

        // https://docs.github.com/en/rest/reference/repos#compare-two-commits
        const { data } = await octokit.request('GET ' + pullRequest.base.repo.compare_url, {
            base,
            head
        });

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
                const pullRequestUser = pullRequest.user.login;

                const reviewed = pullRequestReviews.some(review => {
                    if (review.state !== 'APPROVED') {
                        console.log('✖ Ignoring review of ' + review.user.login + ' with state ' + review.state);

                        return false;
                    }

                    if (!fileAuthors.includes(review.user.login)) {
                        console.log('✖ ' + review.user.login + ' is not an author and not allowed for review');

                        return false;
                    }

                    if (review.commit_id !== head) {
                        console.log('✖ Ignoring old review of ' + review.user.login + ' for ' + review.commit_id);

                        return false;
                    }

                    console.log('✔ Reviewed by ' + review.user.login);

                    return true;
                });

                const isAuthorized = fileAuthors.includes(pullRequestUser) || reviewed

                if (!isAuthorized) {
                    allowMerge = false;
                    console.log('✖ ' + pullRequestUser + ' is not authorized for ' + filename);
                }
            }

            console.log('');
        }

        if (allowMerge) {
            // https://docs.github.com/en/rest/reference/pulls#merge-a-pull-request
            const { data } = await octokit.request('PUT ' + pullRequest._links.self + '/merge', {
                sha: head,
                commit_title: 'Merge #' + pullRequest.number,
                merge_method: 'squash'
            });

            console.log(JSON.stringify(data));
        } else {
            console.log('✖ Merge not allowed.');
        }
    } catch (error) {
        core.setFailed(error.message);
    }
})();