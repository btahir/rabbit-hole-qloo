import type { Entity } from "@/lib/core/types";

// Editorial listening selections, independently checked against the linked
// artist/label pages. Qloo recommends the artist, not this recording.
const listening: Record<
  string,
  {
    title: string;
    url: string;
    note: string;
    source: string;
    sourceUrl?: string;
  }
> = {
  "phoebe bridgers": {
    title: "Motion Sickness",
    url: "https://phoebebridgers.bandcamp.com/track/motion-sickness",
    note: "A specific recording to start with, selected by our editors.",
    source: "Phoebe Bridgers\u2019 Bandcamp",
  },
  "big red machine": {
    title: "Hymnostic",
    url: "https://bigredmachine.bandcamp.com/track/hymnostic",
    note: "A specific recording to start with, selected by our editors.",
    source: "Big Red Machine\u2019s Bandcamp",
  },
  "maggie rogers": {
    title: "Alaska",
    url: "https://www.youtube.com/watch?v=PNWsW6c6t8g",
    note: "A specific recording to start with, selected by our editors.",
    source: "Maggie Rogers\u2019 official video",
  },
  beck: {
    title: "Lost Cause",
    url: "https://www.youtube.com/watch?v=-iEId2vmb0M",
    note: "A specific recording to start with, selected by our editors.",
    source: "Beck\u2019s official video",
  },
  pixies: {
    title: "Here Comes Your Man",
    url: "https://www.youtube.com/watch?v=tPgf_btTFlc",
    note: "A specific recording to start with, selected by our editors.",
    source: "Pixies / 4AD official video",
  },
  "arcade fire": {
    title: "The Suburbs",
    url: "https://www.youtube.com/watch?v=5Euj9f3gdyM",
    note: "A specific recording to start with, selected by our editors.",
    source: "Arcade Fire\u2019s official video",
  },
  nico: {
    title: "These Days",
    url: "https://umj.lnk.to/Nico_TheseDays",
    sourceUrl:
      "https://www.udiscovermusic.com/stories/nico-chelsea-girl-album-review/",
    note: "Start with These Days from Chelsea Girl. The label’s listening link opens this specific song.",
    source: "uDiscover Music / Universal Music",
  },
  "philip glass": {
    title: "Opening",
    url: "https://philipglass.com/recordings/glassworks/",
    note: "Start with the solo-piano Opening from Glassworks, an album Glass wrote to introduce his music to a wider audience.",
    source: "Philip Glass’s official site",
    sourceUrl: "https://philipglass.com/compositions/glassworks/",
  },
  "jóhann jóhannsson": {
    title: "Flight From The City",
    url: "https://johannjohannsson.bandcamp.com/track/flight-from-the-city",
    note: "Try the opening track of Orphée on the artist’s Bandcamp page.",
    source: "Jóhann Jóhannsson’s Bandcamp",
  },
  "steve reich": {
    title: "Music for 18 Musicians",
    url: "https://stevereich.com/composition/music-for-18-musicians/",
    note: "Begin with the opening minutes. Reich’s own notes describe the changing harmonies and the ensemble behind them.",
    source: "Steve Reich’s official site",
  },
  "cocteau twins": {
    title: "Heaven or Las Vegas",
    url: "https://shop.4ad.com/release/339038-cocteau-twins-heaven-or-las-vegas?lang=en_US",
    note: "Try the title track; the album and track list are on their label’s page.",
    source: "4AD",
  },
  björk: {
    title: "Joga",
    url: "https://bjork.bandcamp.com/track/joga",
    note: "One song to start with, from Björk’s own Bandcamp catalogue.",
    source: "Björk’s Bandcamp",
  },
  tindersticks: {
    title: "Tiny Tears",
    url: "https://tindersticks.bandcamp.com/track/tiny-tears",
    note: "Another door into cinema: Tindersticks also used Tiny Tears in a Claire Denis film. The band describes how making her scores changed their music.",
    source: "Tindersticks’ own film-score notes",
    sourceUrl: "https://tindersticks.co.uk/page/2/",
  },
  "leonard cohen": {
    title: "Suzanne",
    url: "https://www.leonardcohen.com/track/suzanne-4",
    note: "Begin with a song: Suzanne, on Leonard Cohen’s official site.",
    source: "Leonard Cohen’s official site",
  },
};
// Exact catalog identities, paired with publisher/distributor excerpts checked in October 2026.
const excerpts: Record<string, { label: string; url: string; source: string }> =
  {
    "8D244758-60B8-446F-95A3-01F035EE5688": {
      label: "Read ‘Soul and Body’",
      url: "https://granta.com/soul-and-body/",
      source:
        "Granta’s published extract from Kundera’s novel; access may require a subscription",
    },
    "9CDA47D5-EE8F-4DB0-B352-A824F8566E9B": {
      label: "Read the opening chapter",
      url: "https://cdn.waterstones.com/special/pdf/9780701186586.pdf",
      source: "Waterstones’ publisher-supplied excerpt, chapter one (PDF)",
    },
    "10428282-2ECA-4C3D-9B3E-19E1E8161099": {
      label: "Read chapter one",
      url: "https://penguinrandomhouselibrary.com/book/?isbn=9780385333849#excerpt",
      source: "Penguin Random House’s excerpt of Slaughterhouse-Five",
    },
    "1A30C7BB-99D4-47D9-A45F-D6B9870DC2E0": {
      label: "Watch the official trailer",
      url: "https://www.youtube.com/watch?v=i_vrlpWB4Vo",
      source:
        "Music Box Films’ trailer, embedded on the distributor’s Ida page",
    },
    "A548E404-B5EA-44BD-80DE-7DFC4FD647C3": {
      label: "Watch the official trailer",
      url: "https://vimeo.com/289292053",
      source: "The Criterion Collection’s trailer for The Tree of Life",
    },
    "15671AC4-102C-4A5E-A702-C7E187BD58C8": {
      label: "Watch the official trailer",
      url: "https://www.barakasamsara.com/content/samsara-theatrical-trailer",
      source: "Samsara’s official theatrical trailer",
    },
    "5C2BF25B-9E1A-4FC0-9821-D42788438972": {
      label: "Read chapter one",
      url: "https://www.simonandschuster.com/books/A-Moveable-Feast/Ernest-Hemingway/9780684824994#excerpt",
      source: "Simon & Schuster’s chapter-one excerpt",
    },
    "A0BB0260-166F-45DD-9045-AFB005CC5CAC": {
      label: "Read ‘The Texan’",
      url: "https://www.simonandschuster.com/books/Catch-22/Joseph-Heller/9781451632965#excerpt",
      source: "Simon & Schuster’s excerpt of chapter one, The Texan",
    },
    "BF077E87-9221-451E-A4A3-61A5475C1671": {
      label: "Read Kesey’s ‘Sketches’",
      url: "https://penguinrandomhousesecondaryeducation.com/book/?isbn=9780141181226#excerpt",
      source:
        "Penguin Random House’s excerpt of Kesey’s introduction, Sketches",
    },
    "935275B7-8B6B-4FB7-8F25-B8155E573362": {
      label: "Watch the official trailer",
      url: "https://www.youtube.com/watch?v=m0cJNR8HEw0",
      source:
        "Sony Pictures Classics’ trailer, linked from the film’s official site",
    },
    "2739C3D2-9B8C-4356-9199-B222D4868B22": {
      label: "Watch the official trailer",
      url: "https://www.youtube.com/watch?v=CpndbbB6Ax8",
      source: "DocPlay’s official trailer",
    },
  };
export function TryThis({
  entity,
  expanded = false,
}: {
  entity: Entity;
  expanded?: boolean;
}) {
  const excerpt = excerpts[entity.id.toUpperCase()];
  if (excerpt)
    return (
      <div className="try-this">
        <span className={`editorial-label${expanded ? "" : " sr-only"}`}>
          A place to start · editorial pick
        </span>
        <a href={excerpt.url} target="_blank" rel="noopener noreferrer">
          {excerpt.label} <span aria-hidden="true">↗</span>
        </a>
        {expanded ? (
          <p className="description-source">
            Source: {excerpt.source}. This starting point is an editorial
            choice.
          </p>
        ) : null}
      </div>
    );
  const pick =
    entity.medium === "artist"
      ? listening[entity.name.toLowerCase()]
      : undefined;
  if (!pick) {
    const ariel =
      entity.medium === "book" &&
      entity.name === "Ariel" &&
      /plath/i.test(
        `${entity.author} ${entity.disambiguation} ${entity.description}`,
      );
    const days =
      entity.id.toUpperCase() === "94416A84-05DB-43B7-A6AC-2EC425A867F9" &&
      entity.medium === "movie";
    const water =
      entity.medium === "book" &&
      /^This Is Water/i.test(entity.name) &&
      /wallace/i.test(
        `${entity.author} ${entity.disambiguation} ${entity.description}`,
      );
    const query = encodeURIComponent(
      `${entity.name} ${entity.author ?? entity.year ?? ""}`,
    );
    const artistUrl = entity.informationUrl?.startsWith(
      "https://open.spotify.com/artist/",
    )
      ? entity.informationUrl
      : undefined;
    const url = ariel
      ? "https://www.poetryfoundation.org/poems/49001/ariel"
      : water
        ? "https://www.kenyon.edu/news/archive/this-is-water/"
        : days
          ? "https://www.youtube.com/watch?v=DCd2ruD1jTA"
          : entity.medium === "movie"
            ? `https://www.youtube.com/results?search_query=${query}%20official%20trailer`
            : entity.medium === "book"
              ? `https://books.google.com/books?q=${query}&printsec=frontcover`
              : (artistUrl ?? `https://open.spotify.com/search/${query}`);
    return (
      <div className="try-this">
        <span className={`editorial-label${expanded ? "" : " sr-only"}`}>
          {ariel || water
            ? "A place to start · editorial pick"
            : entity.medium === "movie"
              ? "A first look"
              : entity.medium === "book"
                ? "A first look"
                : "Keep exploring"}
        </span>
        <a href={url} target="_blank" rel="noopener noreferrer">
          {ariel
            ? "Read the title poem"
            : water
              ? "Read the original speech"
              : days
                ? "Watch the official trailer"
                : entity.medium === "movie"
                  ? "Search for a trailer"
                  : entity.medium === "book"
                    ? "Search for a book preview"
                    : artistUrl
                      ? "Explore on Spotify"
                      : "Search on Spotify"}{" "}
          <span aria-hidden="true">↗</span>
        </a>
        {expanded ? (
          <p className="description-source">
            {ariel
              ? "Source: Poetry Foundation. An editorial starting point, separate from Qloo’s book connection."
              : water
                ? "Source: Kenyon College’s text of David Foster Wallace’s 2005 commencement speech, later published as This Is Water."
                : days
                  ? "Source: Paramount Movies Digital’s official Days of Heaven trailer."
                  : entity.medium === "movie"
                    ? "Searches YouTube for this film’s official trailer; availability varies."
                    : entity.medium === "book"
                      ? "Searches Google Books for this title. Preview availability varies by edition."
                      : artistUrl
                        ? "The artist destination comes from Qloo. Choose one of their popular tracks to begin."
                        : "Searches Spotify for this artist. Choose a track to begin; availability varies."}
          </p>
        ) : null}
      </div>
    );
  }
  return (
    <div className="try-this">
      <span className={`editorial-label${expanded ? "" : " sr-only"}`}>
        A place to start · editorial pick
      </span>
      <a href={pick.url} target="_blank" rel="noopener noreferrer">
        Try “{pick.title}” <span aria-hidden="true">↗</span>
      </a>
      {expanded ? (
        <p>
          {pick.note}{" "}
          <span className="description-source">
            Source:{" "}
            {pick.sourceUrl ? (
              <a
                href={pick.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {pick.source}
              </a>
            ) : (
              pick.source
            )}
            . Qloo’s connection is to the artist, not this song.
          </span>
        </p>
      ) : null}
    </div>
  );
}
