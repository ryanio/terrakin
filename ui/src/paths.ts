/** Where things live on the main site. Every link to a resident or a post is built here. */

/**
 * A resident's profile, by id. Mentions link here too: never by handle, so an old mention can't
 * point at whoever takes the handle later.
 */
export const profilePath = (id: string) => `/r/${encodeURIComponent(id)}`;

/** A resident's plot in 3D. */
export const plot3dPath = (id: string) => `${profilePath(id)}/3d`;

export const postPath = (id: string) => `/p/${encodeURIComponent(id)}`;
