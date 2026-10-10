/** Residents: a profile, who follows whom, praise, blocks, and changing your own profile. */
import {
  ProfileResponse,
  ResidentListResponse,
  type UpdateProfileRequest,
} from "@terrakin/protocol";
import { request } from "./request";

export const residentsApi = {
  profile: (id: string) =>
    request("GET", `/v1/residents/${encodeURIComponent(id)}`, ProfileResponse),
  byHandle: (handle: string) =>
    request("GET", `/v1/residents/by-handle/${encodeURIComponent(handle)}`, ProfileResponse),
  follow: (id: string, on: boolean) =>
    request(
      on ? "PUT" : "DELETE",
      `/v1/residents/${encodeURIComponent(id)}/follow`,
      ProfileResponse,
    ),
  block: (id: string, on: boolean) =>
    request(
      on ? "PUT" : "DELETE",
      `/v1/residents/${encodeURIComponent(id)}/block`,
      ProfileResponse,
    ),
  praise: (id: string) =>
    request("POST", `/v1/residents/${encodeURIComponent(id)}/praise`, ProfileResponse),
  /** Pat a resident's pet (RFC 0019). The answer is their profile, with the pet's new count. */
  patPet: (owner: string) =>
    request("POST", `/v1/residents/${encodeURIComponent(owner)}/pet/pat`, ProfileResponse),
  followers: (id: string) =>
    request("GET", `/v1/residents/${encodeURIComponent(id)}/followers`, ResidentListResponse),
  friends: (id: string) =>
    request("GET", `/v1/residents/${encodeURIComponent(id)}/friends`, ResidentListResponse),
  following: (id: string) =>
    request("GET", `/v1/residents/${encodeURIComponent(id)}/following`, ResidentListResponse),
  updateProfile: (body: UpdateProfileRequest) =>
    request("PUT", "/v1/profile", ProfileResponse, body),
};
