export type EstimateRevision = {
  root_quotation_number: string;
  parent_quotation_number: string;
  revision_quotation_number: string | null;
  revision_type: "Internal" | "External";
  revision_number: number;
};

export type RevisionNode = {
  key: string;
  queryName: string;
  label: string;
  revisionNumber: number;
};

function getRevisionCode(
  revisionType: EstimateRevision["revision_type"],
): "IR" | "CR" {
  return revisionType === "External" ? "CR" : "IR";
}

function parseIdName(value: string | null | undefined): {
  id: string;
  name: string;
} | null {
  if (!value || typeof value !== "string") {
    return null;
  }
  const separatorIndex = value.indexOf("_");
  if (separatorIndex === -1) {
    return null;
  }
  const id = value.slice(0, separatorIndex).trim();
  const name = value.slice(separatorIndex + 1).trim();
  if (!id || !name) {
    return null;
  }
  return { id, name };
}

export function buildRevisionChain(revisions: EstimateRevision[]): RevisionNode[] {
  const nodes = new Map<string, RevisionNode>();
  let rootName: string | null = null;
  let rootId: string | null = null;

  for (const revision of revisions) {
    const rootParsed = parseIdName(revision.root_quotation_number);
    if (!rootName && rootParsed?.name) {
      rootName = rootParsed.name;
      rootId = rootParsed.id;
    }

    const parentParsed = parseIdName(revision.parent_quotation_number);
    if (!rootName && parentParsed?.name) {
      rootName = parentParsed.name;
      rootId = parentParsed.id;
    }
  }

  if (rootName) {
    nodes.set(rootId ?? `root-${rootName}`, {
      key: rootId ?? `root-${rootName}`,
      queryName: rootName,
      label: rootName,
      revisionNumber: 0,
    });
  }

  for (const revision of revisions) {
    const revisionParsed = parseIdName(revision.revision_quotation_number);
    const revisionName = revisionParsed?.name ?? revision.revision_quotation_number;
    if (revisionParsed && revisionName) {
      const rootLabel = rootName ?? revisionName;
      const revisionCode = getRevisionCode(revision.revision_type);
      nodes.set(revisionParsed.id, {
        key: revisionParsed.id,
        queryName: revisionName,
        label: `${rootLabel}-${revisionCode}-${revision.revision_number}(${revisionName})`,
        revisionNumber: revision.revision_number,
      });
    }
  }

  return [...nodes.values()].sort((a, b) => a.revisionNumber - b.revisionNumber);
}
