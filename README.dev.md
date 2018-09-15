# Development

## Cutting a release

- Make the desired changes to this repository.

  - Updating image tags:

    - The vast majority of the time, [Renovate](https://renovatebot.com/docs/docker/) will open PRs in a timely manner.

    - If you want to update them manually, you can update the Docker image versions in `*.Deployment.yaml` to match the tagged version you are releasing.

      - You should look at our [DockerHub repositories](https://hub.docker.com/r/sourcegraph/) to see what the latest versions are.

      - Make sure to include the sha256 digest for each image, which [ensures that each image pull is immutable](https://renovatebot.com/docs/docker/#digest-pinning). Use `docker inspect --format='{{index .RepoDigests 0}}' $IMAGE` to get the digest.

- Open a PR and wait for buildkite to pass and for your changes to be approved, then merge and check out master.
- Test what is currently checked in to master by [installing](docs/install.md) Sourcegraph on fresh cluster.
- Create a git tag and push it to the repository:

  ```bash
  VERSION = vX.Y.Z

  # If this is a release candidate: VERSION = `vX.Y.Z-pre${N}` (where `N` starts at 0 and increments as you test/cut new versions)

  # 🚨 Make sure that you have the commit that you want to tag as $VERSION checked out!

  git tag $VERSION
  git push origin $VERSION
  ```

- Cut the legacy Helm version of the release (this step will be deprecated after the next iteration):

  - checkout [deploy-sourcegraph@helm-legacy](https://github.com/sourcegraph/deploy-sourcegraph/tree/helm-legacy)
  - update the image tags in [yalues.yaml](https://github.com/sourcegraph/deploy-sourcegraph/blob/helm-legacy/values.yaml)
  - run [generate.sh](https://github.com/sourcegraph/deploy-sourcegraph/blob/helm-legacy/generate.sh)
  - run [release.sh](https://github.com/sourcegraph/deploy-sourcegraph/blob/helm-legacy/release.sh)

- [Update the `latestReleaseDataCenterBuild` value in `sourcegraph/sourcegraph`](https://sourcegraph.sgdev.org/github.com/sourcegraph/sourcegraph/-/blob/cmd/server/README.md#5-notify-existing-instances-that-an-update-is-available)
