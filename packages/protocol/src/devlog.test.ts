import { describe, expect, it } from "vitest";
import {
  DEVLOG_WORDS_MAX,
  DevlogError,
  devlogAtom,
  devlogImages,
  devlogLead,
  devlogPage,
  devlogWords,
  parseDevlog,
} from "./devlog";

/** A post file. One without an image gets a screenshot for its day, since every post needs one. */
const post = (name: string, text: string) => {
  const day = /^(\d{4}-\d{2}-\d{2})\.md$/.exec(name)?.[1];
  const shot = `\n\n![A test screenshot](/devlog/images/${day}-shot.jpg)\n`;
  return { file: `docs/devlog/${name}`, text: day && !text.includes("![") ? text + shot : text };
};

const fails = (name: string, text: string, raw = false) => {
  try {
    parseDevlog([raw ? { file: `docs/devlog/${name}`, text } : post(name, text)]);
  } catch (err) {
    expect(err).toBeInstanceOf(DevlogError);
    return (err as Error).message;
  }
  throw new Error("expected the post to be refused");
};

describe("reading docs/devlog", () => {
  it("reads each post's title, summary, and body, newest first, and skips other files", () => {
    const posts = parseDevlog([
      post(
        "2026-10-04.md",
        "# Devlog 2026-10-04: the world is live\n\nWe opened the doors.\nPeople came in.\n\n## Since then\n\nThe [plan](../plans/README.md#now) moved.\n",
      ),
      post(
        "2026-10-06.md",
        "# Devlog 2026-10-06\n\n## First\n\nA `build`, **bold**, and [a link](/docs).\n",
      ),
      post("README.md", "Not a post."),
    ]);
    expect(posts.map((p) => p.date)).toEqual(["2026-10-06", "2026-10-04"]);
    expect(posts[1]).toMatchObject({
      title: "The world is live",
      summary: "We opened the doors. People came in.",
      url: "https://terrakin.org/devlog/2026-10-04",
    });
    // A link into the repo points at the file on GitHub, so it works on the site and in the API.
    expect(posts[1]?.body).toContain(
      "[plan](https://github.com/ryanio/terrakin/blob/main/docs/plans/README.md#now)",
    );
    // A heading with nothing after the day is the title; the summary is the first paragraph's words.
    expect(posts[0]).toMatchObject({
      title: "Devlog 2026-10-06",
      summary: "A build, bold, and a link.",
    });
    expect(posts[0]?.body.startsWith("## First")).toBe(true);
  });

  it("cuts a long first paragraph at its last sentence that fits, or at a word", () => {
    const sentence = "Pumpkins grew all week along the paths. ";
    const [long] = parseDevlog([post("2026-10-06.md", `# A long one\n\n${sentence.repeat(12)}`)]);
    expect(long?.summary.length).toBeLessThanOrEqual(280);
    expect(long?.summary.endsWith("paths.")).toBe(true);
    const [wordy] = parseDevlog([post("2026-10-06.md", `# Words\n\n${"pumpkin ".repeat(60)}`)]);
    expect(wordy?.summary.length).toBeLessThanOrEqual(280);
    expect(wordy?.summary.endsWith("pumpkin…")).toBe(true);
  });

  it("refuses a post it can't read, naming the file and the fix", () => {
    expect(fails("2026-10-06.md", "No title here.")).toMatch(
      /^docs\/devlog\/2026-10-06\.md: the first line is its title/,
    );
    expect(fails("2026-10-06.md", "# Title\n\nA dash — here.")).toMatch(
      /line 3 has an em or en dash/,
    );
    expect(fails("2026-10-06.md", "# Title\n\n## Only a heading\n")).toMatch(/needs a paragraph/);
    expect(fails("2026-02-30.md", "# Title\n\nWords.")).toMatch(/named for its day/);
  });
});

describe("short posts with screenshots", () => {
  const shot = (name: string) => `![A plot with a pet](/devlog/images/2026-10-07-${name}.jpg)`;

  it("reads a short post's screenshots, and leaves them out of the lead and the word count", () => {
    const [p] = parseDevlog([
      post(
        "2026-10-07.md",
        `# Pets\n\n${shot("pets")}\n\nYou can adopt a pet.\n\n${shot("pat")}\n`,
      ),
    ]);
    expect(p?.summary).toBe("You can adopt a pet.");
    expect(devlogImages(p?.body ?? "")).toEqual([
      { alt: "A plot with a pet", src: "/devlog/images/2026-10-07-pets.jpg" },
      { alt: "A plot with a pet", src: "/devlog/images/2026-10-07-pat.jpg" },
    ]);
    expect(devlogWords(p?.body ?? "")).toBe(5);
  });

  it("refuses a long post, one with no screenshot or too many, and a screenshot from elsewhere", () => {
    const long = "word ".repeat(DEVLOG_WORDS_MAX + 1);
    expect(fails("2026-10-07.md", `# Long\n\n${long}\n\n${shot("a")}`)).toMatch(
      /251 words\. A post is 250 at most/,
    );
    expect(fails("2026-10-07.md", "# None\n\nWords.", true)).toMatch(/0 screenshots/);
    expect(
      fails("2026-10-07.md", `# Many\n\nWords.\n\n${["a", "b", "c", "d"].map(shot).join("\n\n")}`),
    ).toMatch(/4 screenshots/);
    expect(
      fails("2026-10-07.md", "# Elsewhere\n\nWords.\n\n![x](https://example.com/x.jpg)"),
    ).toMatch(/isn't a screenshot of this post/);
    expect(
      fails("2026-10-07.md", "# Other day\n\nWords.\n\n![x](/devlog/images/2026-10-06-a.jpg)"),
    ).toMatch(/isn't a screenshot of this post/);
    expect(
      fails("2026-10-07.md", "# No alt\n\nWords.\n\n![](/devlog/images/2026-10-07-a.jpg)"),
    ).toMatch(/needs alt text/);
    expect(fails("2026-10-07.md", `# Inline\n\nWords ${shot("a")} here.`)).toMatch(
      /line 3 has an image inside other text/,
    );
  });
});

describe("the home wall card's lead", () => {
  it("is the first paragraph, and the rest keeps everything around it", () => {
    expect(devlogLead("One line\nand its second.\n\n## More\n\nRest.")).toEqual({
      lead: "One line\nand its second.",
      rest: "## More\n\nRest.",
    });
    // A post that opens with a heading keeps the heading in the rest.
    expect(devlogLead("## What got built\n\nDay two.\n\n- a list")).toEqual({
      lead: "Day two.",
      rest: "## What got built\n\n- a list",
    });
    expect(devlogLead("Only this.")).toEqual({ lead: "Only this.", rest: "" });
  });
});

describe("the page and the feed", () => {
  const posts = parseDevlog([
    post("2026-10-05.md", "# Devlog 2026-10-05: Pets & <paths>\n\nA cat moved in.\n"),
    post("2026-10-06.md", "# Devlog 2026-10-06: Autumn\n\nLeaves fell.\n"),
  ]);

  it("lists posts newest first on /devlog, each with its day and a link to its page", () => {
    const page = devlogPage(posts);
    expect([...page.matchAll(/^## (.+)$/gm)].map((m) => m[1])).toEqual([
      "Autumn",
      "Pets & <paths>",
    ]);
    expect(page).toContain(
      "*October 6, 2026*\n\nLeaves fell.\n\n[Read the post](/devlog/2026-10-06)",
    );
  });

  it("gives each post a stable Atom id and escapes its words", () => {
    const feed = devlogAtom(posts);
    expect(feed).toContain("<id>tag:terrakin.org,2026-10-02:devlog/2026-10-05</id>");
    expect(feed).toContain("<title>Pets &amp; &lt;paths&gt;</title>");
    expect(feed).toContain("<updated>2026-10-06T00:00:00Z</updated>");
    expect(feed.match(/<entry>/g)).toHaveLength(2);
  });
});
