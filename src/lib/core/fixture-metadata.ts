import type { Entity } from "./types";
// Short factual paraphrases checked against the linked primary pages, 2026-10-17.
// Only the identities/metadata are factual. All example connections remain synthetic.
export const fixtureMetadata: Record<
  string,
  Pick<Entity, "description" | "descriptionSource" | "informationUrl">
> = {
  "The Left Hand of Darkness": {
    description:
      "An envoy arrives on a frozen world whose people can change gender.",
    descriptionSource: "Ursula K. Le Guin's official site",
    informationUrl: "https://www.ursulakleguin.com/left-hand-darkness",
  },
  "Talk Talk": {
    description:
      "The band behind Spirit of Eden, a 1988 album that traded synthesizers for live instrumentation.",
    descriptionSource: "Rhino",
    informationUrl: "https://www.rhino.com/aod/spirit-of-eden-talk-talk",
  },
  "Ryuichi Sakamoto": {
    description:
      "Composer and pianist, from Yellow Magic Orchestra to film scores.",
    descriptionSource: "Official biography",
    informationUrl: "https://www.sitesakamoto.com/biography/",
  },
  "Joni Mitchell": {
    description:
      "A singer, songwriter and painter whose recordings move between folk and jazz.",
    descriptionSource: "Official biography",
    informationUrl: "https://www.jonimitchell.com/biography/",
  },
  "Cocteau Twins": {
    description:
      "Elizabeth Fraser, Robin Guthrie and Simon Raymonde's group, whose recordings include Treasure and Blue Bell Knoll.",
    descriptionSource: "Official artist site",
    informationUrl: "https://cocteautwins.com/introduction.html",
  },
  Beloved: {
    description:
      "In Ohio, Sethe has escaped slavery, but her home is haunted by the child she lost.",
    descriptionSource: "Penguin Random House",
    informationUrl:
      "https://assets.penguinrandomhouse.com/book-resumes/MorrisonToni_Beloved.pdf",
  },
  "Invisible Cities": {
    description:
      "Marco Polo describes imagined cities to Kublai Khan; their conversations circle back to a single city.",
    descriptionSource: "Penguin",
    informationUrl:
      "https://www.penguin.co.uk/books/357001/invisible-cities-by-italo-calvino/9781446414279",
  },
  "The Waves": {
    description:
      "Six friends' intertwined voices follow their lives from childhood into adulthood.",
    descriptionSource: "Penguin Random House",
    informationUrl:
      "https://www.penguinrandomhouse.com/books/193878/the-waves-by-virginia-woolf-introduction-by-frances-spalding/",
  },
  Jazz: {
    description:
      "In 1926 Harlem, a murder exposes the tangled lives of Joe Trace, his wife Violet and his young lover.",
    descriptionSource: "Penguin Random House",
    informationUrl:
      "https://www.penguinrandomhouse.com/books/117649/jazz-by-toni-morrison-with-a-new-introduction-by-kevin-young/9781400076215/",
  },
  "Paris, Texas": {
    description:
      "A drifter tries to reconnect with his young son and missing wife.",
    descriptionSource: "The Criterion Collection",
    informationUrl: "https://www.criterion.com/films/1502-paris-texas",
  },
  "After Life": {
    description:
      "The recently deceased must choose one memory to carry with them, recreated on film.",
    descriptionSource: "The Criterion Collection",
    informationUrl: "https://www.criterion.com/films/29081-after-life",
  },
  "In the Mood for Love": {
    description:
      "Two neighbors discover that their spouses are having an affair.",
    descriptionSource: "The Criterion Collection",
    informationUrl:
      "https://www.criterion.com/current/posts/197-in-the-mood-for-love",
  },
};
