We happily welcome contributions to the Databricks Apps templates repo. We use [GitHub Pull Requests](https://github.com/databricks/app-templates/pulls) for accepting changes.
Contributions are licensed on a license-in/license-out basis.

# Contributing Guide

## Communication
Before starting work on a new app template, please reach out to the Databricks Apps team. We will make sure no one else is already working on it and that it is aligned with the Databricks Apps team goals.
This is to prevent your time being wasted, as well as ours.
The GitHub review process for new app templates is important so that the databricks app team and contributors with commit access can come to agreement on design.

## Pull Request
In the pull request, include a description of the changes and, if relevant, how the app(s) was/were tested.

## Coding Style
Code style is enforced by a formatter check in your pull request. We use [yapf](https://github.com/google/yapf) to format our code. Run `make fmt` to ensure your code is properly formatted prior to raising a pull request.

## Signed Commits
This repo requires all contributors to sign their commits. To configure this, you can follow [Github's documentation](https://docs.github.com/en/authentication/managing-commit-signature-verification/signing-commits) to create a GPG key, upload it to your Github account, and configure your git client to sign commits.

## Developer Certificate of Origin

To contribute to this repository, you must sign off your commits to certify 
that you have the right to contribute the code and that it complies with the 
DB license. The rules are pretty simple, if you can certify the 
content of [DCO](./DCO), then simply add a "Signed-off-by" line to your 
commit message to certify your compliance. Please use your real name as 
pseudonymous/anonymous contributions are not accepted.

```
Signed-off-by: Joe Smith <joe.smith@email.com>
```

If you set your `user.name` and `user.email` git configs, you can sign your 
commit automatically with `git commit -s`:

```
git commit -s -m "Your commit message"
```
