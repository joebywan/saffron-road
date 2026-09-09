# Saffron Road

A trading game for the phone, with bot opponents. You against one, two or three
of them: buy holdings along a spice road, take the goods that pay for them, and
get the trading companies to sign with you.

**[Download the latest APK →](https://github.com/joebywan/saffron-road/releases/latest)**

Android 7.0 or newer. Other ways to play, and how to build it yourself, are in
[INSTALL.md](INSTALL.md).

## It does not use the network

The Android app does not hold the `INTERNET` permission. Not "does not phone
home" — it *cannot*. Every byte it draws comes out of the app itself, so there
is no telemetry, no account, no analytics and nothing to switch off. It plays
identically in aeroplane mode, because that is the only mode it has.

Your game is saved on the device and nowhere else. Close the app mid-game and
it comes back where you left it.

## How to play

You are a merchant. Take goods, spend them on holdings, and let the holdings
pay for the next ones. First to **15 points** triggers a final round, and
everyone finishes on the same number of turns.

There is a **How to play** sheet on the title screen and in the in-game menu.
This is the same thing, for reading before you install.

### On your turn, exactly one of these

| | |
| --- | --- |
| **Take 3 different goods** | One each from three different piles. |
| **Take 2 of one good** | Only from a pile holding 4 or more. |
| **Buy a holding** | A card on the table, or one you reserved earlier. |
| **Reserve a holding** | It goes to your hand for later, and you take a coin. Three at most. |

### What the holdings do

Every card you buy produces one good, for ever. That production is a permanent
discount on everything you buy afterwards — which is why the cost printed on a
card is not always what you pay, and why the expensive cards eventually cost
nothing.

The three decks are the same idea at three prices. **Caravans** are cheap and
rarely score. **Warehouses** sit in the middle. **Routes** are expensive and
carry the points. You climb from one to the next.

Coins are wild and cover anything. Reserving is the only way to get one.

### Companies sign on their own

Each company wants a number of holdings producing particular goods. Meet its
requirements and it signs with you at the end of your turn, worth points. You
never spend anything on a company and you cannot decline one — though when
several qualify at once, you choose which.

### Reserving, and who sees what

This one catches people, and it is a real rule rather than a UI choice:

- Reserve a card **from the table** and everyone saw you take it. It stays
  visible in your hand for the rest of the game.
- Reserve **blind, off the top of a deck**, and only you know what it is.
  Opponents see that you hold something, and nothing more.

Knowing an opponent is sitting on a specific high-scoring card is the
difference between racing them and blocking them. A face-down reserve tells you
only that they have *something*.

### The two rules that catch people

- **Ten tokens is the limit.** Over it at the end of your turn and you return
  the excess. Coins count.
- **Reaching 15 does not end the game.** It triggers the last round, and
  everyone still gets an equal number of turns. Most points wins; ties break to
  whoever bought the fewest cards.

## Bots

One human, always — you plus one to three bots, at easy, normal or hard. The
board is drawn from your seat and only your seat: card costs carry *your*
discounts on every turn, including while a bot is moving, so the board is never
reinterpreted around you. Whose turn it is is said in the turn indicator and
narrated in the move log.

Bots cannot cheat. They are handed a redacted view with the deck order stripped
and opponents' blind-drawn reserves hidden — the same view you have.

## The rest

- [INSTALL.md](INSTALL.md) — getting it on a phone, playing over wifi, and
  building the APK from source.
- [DEVELOPING.md](DEVELOPING.md) — how the project is put together, how
  releases work, and why the UI is the way it is.

No build step, no dependencies, no framework. Plain ES modules.
