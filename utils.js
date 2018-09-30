const util = require("util");
const fs = require("fs");
const bytes = require("bytes");
const glob = require("glob");
const gzipSize = require("gzip-size");
const tmp = require("tmp");
const parseGitConfig = require("parse-git-config");
const { spawn } = require("child_process");

const fsClose = util.promisify(fs.close);
const fsOpen = util.promisify(fs.open);
const fsReadFile = util.promisify(fs.readFile);
const fsStat = util.promisify(fs.stat);
const tmpName = util.promisify(tmp.tmpName);

function getFileSize(path, gzipped = false) {
    if (gzipped) {
        return fsReadFile(path, "utf8").then(gzipSize);
    }

    return fsStat(path).then(stats => stats.size);
}

function execCommand(command) {
    return new Promise((resolve, reject) => {
        const bufs = [];
        const errBufs = [];
        const proc = spawn("/bin/sh", ["-o", "pipefail", "-c", command]);

        proc.on("error", error => {
            reject(error);
        }).on("exit", code => {
            if (code) {
                reject(new Error(`"${command}" exited with code ${code}:\n${Buffer.concat(errBufs).toString()}`));
            } else {
                resolve(Buffer.concat(bufs).toString());
            }
        });

        proc.stdout.on("data", data => {
            bufs.push(data);
        }).on("error", error => {
            reject(error);
        });

        proc.stderr.on("data", data => {
            errBufs.push(data);
        }).on("error", error => {
            reject(error);
        });
    });
}

module.exports = {
    readFiles(config) {
        return Promise.all(config.map(fileConfig => {
            const paths = glob.sync(fileConfig.path);
            if (!paths.length) {
                console.log(`There is no matching file for ${fileConfig.path} in ${process.cwd()}`);
                return [];
            }

            return Promise.all(paths.map(path => {
                const gzippedSize = "gzip" in fileConfig ? fileConfig.gzip : true;

                return getFileSize(path, gzippedSize).then(size => ({
                    limit: bytes(fileConfig.limit) || Infinity,
                    size,
                    path
                }));
            }));
        })).then(results => results.reduce((prev, cur) => prev.concat(cur), []));
    },
    generateBundleStats(filepath) {
        return new Promise((resolve, reject) => {
            tmpName().then(name =>
                fsOpen(name, "a").then(fd => ({
                    fd,
                    name
                }))
            ).then(({ fd, name }) => {
                const proc = spawn("/bin/sh", ["-o", "pipefail", "-c", `source-map-explorer --json ${filepath}`], {
                    stdio: ["inherit", fd, "inherit"]
                });

                proc.on("error", error => {
                    reject(error);
                }).on("close", code => {
                    if (code) {
                        reject(new Error(`source-map-explorer exited with code ${code}`));
                    } else {
                        fsClose(fd).then(
                            () => fsReadFile(name)
                        ).then(
                            buf => resolve(JSON.parse(buf.toString()))
                        );
                    }
                });
            });
        });
    },
    getRepoName() {
        return new Promise((resolve, reject) => {
            parseGitConfig({ cwd: process.cwd() }, (err, config) => {
                if (err) {
                    reject(err);
                    return;
                }

                const m = config['remote "origin"'].url.match(/[/:]((?:[^/]+)\/(?:[^/]+)).git$/);

                if (!m) {
                    reject(new Error("Repository name couldn't be parsed"));
                    return;
                }

                const [, repoName] = m;

                resolve(repoName);
            });
        });
    },
    getRepoHeadHash() {
        return execCommand("git rev-parse HEAD").then(output => output.trim());
    }
};