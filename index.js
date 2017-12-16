const request = require("request-promise-native");
const utils = require("./utils");
const { pkg } = require("read-pkg-up").sync();
const githubToken = process.env.GITHUB_TOKEN; // eslint-disable-line no-process-env

function postStats(stats) {
    const requestOptions = Object.assign({
        uri: "https://bascule.now.sh/api/stats",
        method: "POST",
        simple: false,
        resolveWithFullResponse: true,
        json: true,
        headers: {
            "exq-github-token": githubToken
        },
        body: stats
    });

    return request(requestOptions).then(r => console.log(r.body));
}

/**
 * Request body has the following format:
 *  {
 *      "repo": "reponame",
 *      "sha": "commitid"
 *      "bundles": {
 *          "bundle_1": {
 *              "details": {
 *                  "module1": ..,
 *                  "module2": ..,
 *                  "module3": ..
 *              },
 *              "limit": "3kb",
 *              "size": "2kb",
 *              "success": true
 *          }
 *      }
 *  }
 */

let prNumber;

if (process.argv.length > 2) {
    ([,, prNumber] = process.argv);
}

Promise.all([
    utils.getRepoName(),
    utils.getRepoHeadHash(),
    utils.readFiles(pkg.bascule)
]).then(([repo, sha, files]) => {
    Promise.all(files.map(entry => (
        utils.generateBundleStats(entry.path).then(stats => {
            delete stats["<unmapped>"];

            return Object.assign(entry, { stats });
        }).catch(err => {
            console.log(err);
        })
    ))).then(entries => (
        entries.filter(Boolean).map(entry => ({
            file: entry.path,
            details: entry.stats,
            limit: entry.limit !== Infinity ? entry.limit : null,
            size: entry.size,
            success: entry.size < entry.limit
        }))
    )).then(entries => ({
        repo,
        sha,
        bundles: entries
    })).then(stats => {
        return postStats(Object.assign(stats, { pr: prNumber }));
    });
});
