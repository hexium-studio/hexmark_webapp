# Contributing to Hexmark

Thanks for your interest in Hexmark! This document explains how to contribute.

## Scope

Hexmark is a **wiki only** – notes, links, search, revisions and the MCP
interface for agents. Proposals for project boards, task management or other
modules will be declined. If you are unsure whether an idea fits, open an
issue and ask before you write code.

## Licensing of contributions

Hexmark is licensed under the [Apache License 2.0](LICENSE). By contributing,
you agree that your contribution is licensed under the same license
("inbound = outbound", see section 5 of the license). There is no separate
Contributor License Agreement.

## Developer Certificate of Origin (DCO)

Every commit must be signed off. The sign-off certifies that you wrote the
change or otherwise have the right to submit it under the project license,
as described in the [Developer Certificate of Origin 1.1](https://developercertificate.org/):

> By making a contribution to this project, I certify that:
>
> (a) The contribution was created in whole or in part by me and I have the
> right to submit it under the open source license indicated in the file; or
>
> (b) The contribution is based upon previous work that, to the best of my
> knowledge, is covered under an appropriate open source license and I have
> the right under that license to submit that work with modifications,
> whether created in whole or in part by me, under the same open source
> license (unless I am permitted to submit under a different license), as
> indicated in the file; or
>
> (c) The contribution was provided directly to me by some other person who
> certified (a), (b) or (c) and I have not modified it.
>
> (d) I understand and agree that this project and the contribution are
> public and that a record of the contribution (including all personal
> information I submit with it, including my sign-off) is maintained
> indefinitely and may be redistributed consistent with this project or the
> open source license(s) involved.

Add the sign-off with `git commit -s`. It appends a line like:

```
Signed-off-by: Your Name <you@example.com>
```

Pull requests with commits that are not signed off cannot be merged.

## Pull requests

- Keep changes focused – one topic per pull request.
- Write code, identifiers, comments and commit messages in English.
- Keep source files small and split by responsibility
  (guideline: about 200 lines, never more than 250).
- Do not commit secrets, tokens, real domains, IP addresses or personal data.
  Use environment variables and neutral examples such as `example.com`.
- User interface changes must meet WCAG 2.1 AA and respect the user's system
  settings for colour scheme and reduced motion.

## Reporting bugs

Open an issue with steps to reproduce, the expected and the actual result.
For security issues, follow [SECURITY.md](SECURITY.md) instead.
