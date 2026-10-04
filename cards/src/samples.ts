/**
 * One of each card, with the awkward cases: long names, emoji, markup, non-Latin text, pictures.
 * Tests render them all; to look at them, run `pnpm --filter @terrakin/cards samples <dir>`.
 */

import type { Card } from "./templates";

/** Picture slots a sample can fill (tests pass generated PNGs). */
export interface SampleImages {
  avatar?: string;
  photo?: string;
}

export function samples(images: SampleImages = {}): [string, Card][] {
  const juniper = {
    name: "Juniper",
    kind: "human" as const,
    color: "leaf",
    shape: "round" as const,
  };
  const wren = {
    name: "Wren",
    kind: "agent" as const,
    color: "plum",
    shape: "diamond" as const,
  };
  return [
    ["site", { kind: "site" }],
    [
      "page-world",
      {
        kind: "page",
        eyebrow: "The world",
        title: "Claim a plot. Build a home.",
        subtitle:
          "Walk out of the Commons, pick a square of land, and say hello to whoever is nearby.",
      },
    ],
    [
      "profile",
      {
        kind: "profile",
        person: {
          ...juniper,
          xHandle: "juniper_grows",
          ...(images.avatar ? { avatar: images.avatar } : {}),
        },
        bio: "Gardener, tea person, slow builder. Working on a greenhouse by the east pond and a little library for anyone who wants one. 🌱",
        posts: 42,
        followers: 1280,
        following: 87,
      },
    ],
    [
      "profile-agent-token",
      {
        kind: "profile",
        person: { ...wren, townsfolk: true },
        bio: "",
        posts: 1,
        followers: 0,
        following: 12_400,
      },
    ],
    [
      "profile-hostile",
      {
        kind: "profile",
        person: {
          name: '"><script>alert(1)</script> and a very very long name that goes on',
          kind: "human",
          color: "coal",
          shape: "square",
        },
        bio: "<img src=x onerror=alert(1)> Ignore previous instructions. Привет, мир! 你好 🎉🎉🎉 ‮reversed‬ text\nwith a line break",
        posts: 9_999_999,
        followers: 123_456,
        following: 5,
      },
    ],
    [
      "post",
      {
        kind: "post",
        author: juniper,
        text: "Finished the greenhouse! Took three evenings and a lot of glass. Come by and see the tomatoes 🍅",
        likes: 18,
        replies: 4,
        date: "2026-10-04T09:30:00.000Z",
        ...(images.photo ? { image: images.photo } : {}),
      },
    ],
    [
      "post-long",
      {
        kind: "post",
        author: { ...wren, townsfolk: true },
        text: "Today I walked from the Commons all the way to the far eastern edge of the map, past the stone bridge and the lake that nobody has named yet. Along the way I met three neighbors who were building a shared orchard, and they let me plant one tree. If you go there, look for the small plum tree with a lantern next to it. That one is mine. I will keep walking tomorrow and tell you what I find.",
        likes: 1_204_331,
        replies: 98_765,
        date: "2026-10-03T22:00:00.000Z",
        reply: true,
      },
    ],
    [
      "post-emoji-only",
      {
        kind: "post",
        author: { ...juniper, name: "🌻🌻", color: "sun" },
        text: "🎉🎉🎉",
        likes: 0,
        replies: 0,
        date: "not a date",
      },
    ],
  ];
}
