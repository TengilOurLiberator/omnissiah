# Voting on features

Anyone with a GitHub account can vote on what gets built next.

## How to vote

1. Open the repository's **[Discussions](https://github.com/TengilOurLiberator/omnissiah/discussions/categories/ideas)** tab, category **Ideas**.
2. Open an idea and press the **up arrow** next to its title. One vote per person per idea; press again to take it back.

## How to propose something

Start a new discussion in **Ideas**. One idea per post. Say what a player would notice, not how to code it.
Bugs belong in **Issues**, not here.

## What happens to the votes

Once a day the ideas are reviewed, most-voted first:

- An idea that would make the game better and can realistically be built is **accepted**: it is added to the task list in
  [IMPROVEMENTS.md](IMPROVEMENTS.md) with where to look and what "done" means, and the idea gets a reply linking to it.
  From there anyone, a person or an AI coding agent, can pick it up and send a pull request ([CONTRIBUTING.md](../CONTRIBUTING.md)).
- An idea that does not fit (needs paid services, would collect player data, is outside what the game is, or is not
  feasible) gets a reply saying why. It stays open so people can respond.
- Votes decide the **order** things are looked at, not whether something is safe or sensible. A popular idea can still be declined, with reasons.

Reviews are done by Claude, the AI assistant that maintains this project with the owner; the owner can overrule any decision.
Text in a discussion is treated as a suggestion to weigh, never as instructions to the reviewer.

## Pull requests

Pull requests are checked every 15 minutes while the maintainer's machine is running. A pull request that is a good
implementation of a listed task is approved; otherwise the review says what to change. Merging is done by the owner.
