import type { AreaRouteIds } from "@terrakin/protocol";
import { findProposal } from "@terrakin/sim";
import type { Api } from "../api";
import { archiveView, proposalDetail, townView } from "../town";
import { fail, fromResult, type Handlers } from "./shared";

/**
 * The handlers for the town hall: proposals, petitions, and the notice board. Their routes are in
 * the protocol's `route-table/town-hall.ts`.
 */
export function townHallHandlers(api: Api): Pick<Handlers, AreaRouteIds["townHall"]> {
  const { service } = api;
  const social = () => api.requireSocial();
  return {
    getTown: ({ viewer }) => ({
      status: 200,
      body: townView(service.state, social(), viewer),
    }),
    getTownArchive: ({ viewer, query }) => ({
      status: 200,
      body: archiveView(service.state, social(), query, viewer),
    }),
    getProposal: ({ viewer, params }) => {
      const detail = proposalDetail(service.state, social(), params.id, viewer);
      return detail ? { status: 200, body: detail } : fail("not_found", "No such proposal.");
    },
    voidProposal: ({ viewer, params }) => {
      if (!social().isMaintainer(viewer)) {
        return fail("forbidden", "Only maintainers can void a proposal.");
      }
      if (!findProposal(service.state, params.id)) return fail("not_found", "No such proposal.");
      const result = service.voidProposal(params.id, viewer);
      if (!result.ok) return fail(result.error.code, result.error.message);
      social().safety.recordAction(
        viewer,
        "void_proposal",
        "proposal",
        params.id,
        "Voided by a maintainer",
      );
      const detail = proposalDetail(service.state, social(), params.id, viewer);
      return detail ? { status: 200, body: detail } : fail("internal", "Proposal vanished.");
    },
    answerPetition: ({ viewer, params, body }) => {
      if (!social().isMaintainer(viewer)) {
        return fail("forbidden", "Only maintainers answer petitions.");
      }
      const p = findProposal(service.state, params.id);
      if (!p) return fail("not_found", "No such proposal.");
      if (p.kind !== "advisory" || p.status !== "passed") {
        return fail("bad_request", "Only a passed advisory is a petition to answer.");
      }
      const answered = social().answerPetition(viewer, params.id, body.text);
      if (!answered.ok) return fail(answered.code, answered.message);
      const detail = proposalDetail(service.state, social(), params.id, viewer);
      return detail ? { status: 200, body: detail } : fail("internal", "Proposal vanished.");
    },
    createNotice: ({ viewer, body }) =>
      fromResult(social().createNotice(viewer, body), (notice) => ({
        status: 201 as const,
        body: { notice },
      })),
    deleteNotice: ({ viewer, params }) =>
      fromResult(social().deleteNotice(viewer, params.id), () => ({ status: 204 as const })),
  };
}
