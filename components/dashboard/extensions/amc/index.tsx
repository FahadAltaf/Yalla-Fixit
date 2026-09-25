"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { ArrowLeft, Check, FileText, Loader2, ScrollText, SendHorizonal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageHeading } from "@/components/dashboard/shared/kaizen";
import { useConfirm } from "@/components/dashboard/shared/kaizen-states";
import { Card } from "@/components/ui/card";
import { Form } from "@/components/ui/form";
import { cn } from "@/lib/utils";
import { amcSubmissionsService } from "@/modules/amc-submissions";

import { getDefaultFormValues } from "./amc-constants";
import {
  formDataToSubmissionPayload,
  submissionToFormData,
} from "./amc-submission-mapper";
import { buildAmcPdf } from "./amc-document-utils";
import { SubmissionStatusBanner } from "./submission-status-banner";
import { AmcPreviewDialog } from "./amc-preview-dialog";
import { computeAmcData, syncServiceRowsForUnitType } from "./amc-pricing";
import {
  amcFormSchema,
  type AmcDocumentType,
  type AmcFormData,
  type AmcSubmissionStatus,
} from "./amc-types";
import type { AmcSettings } from "./amc-settings";
import { amcSettingsService } from "@/modules/amc-submissions";
import { PropertyCustomerStep } from "./steps/property-customer-step";
import { ServicesPricingStep } from "./steps/services-pricing-step";
import { ReviewStep } from "./steps/review-step";
import { useBreadcrumbLabel } from "@/components/dashboard-layout/breadcrumb-labels";

const STEPS = [
  {
    id: 1,
    title: "Property and customer",
    description: "Property, client, and contract details",
  },
  {
    id: 2,
    title: "Services and pricing",
    description: "Service table, base prices and discount",
  },
  {
    id: 3,
    title: "Review and submit",
    description: "Summary, preview and submit for approval",
  },
] as const;

const STEP_FIELDS: Partial<Record<number, (keyof AmcFormData)[]>> = {
  1: [
    "propertyCategory",
    "unitType",
    "propertyAddress",
    "propertyDetail",
    "customerName",
    "customerId",
    "customerPhone",
    "customerEmail",
    "startDate",
    "endDate",
    "paymentTerms",
    "coordinationContacts",
  ],
  2: [
    "serviceRows",
    "discountPercent",
    "optionalSections",
    "priceListRows",
    "accountManagers",
  ],
};

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

const STEP_VALIDATION_MESSAGES: Record<number, string> = {
  1: "Fill in the property, customer and contract details before you continue.",
  2: "Pick at least one service and give each one units, a frequency and a base price before you continue.",
};

function scrollWizardContainerToTop(element: HTMLElement | null) {
  if (!element) return;

  let parent: HTMLElement | null = element.parentElement;
  while (parent) {
    if (parent.dataset.slot === "scroll-area-viewport") {
      parent.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    const { overflowY } = getComputedStyle(parent);
    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      parent.scrollHeight > parent.clientHeight
    ) {
      parent.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    parent = parent.parentElement;
  }

  element.scrollIntoView({ behavior: "smooth", block: "start" });
}

/**
 * The AMC proposal wizard: /extensions/amc/new for a new proposal, and
 * /extensions/amc/<id>/edit for a draft (or one sent back). The list and a
 * proposal's details are their own pages now; this is only the form.
 *
 * The step is kept in the address (?step=), so a reload lands on the step
 * you were on.
 */
export function AmcWizard({ submissionId }: { submissionId?: string } = {}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialStep = useRef(Number(searchParams.get("step")) || 1);
  const [currentStep, setCurrentStep] = useState(1);
  /* The furthest step reached. Every step up to it stays clickable in the
     step pills, forwards as well as back. */
  const [furthestStep, setFurthestStep] = useState(1);
  // True while the proposal named in the address is being loaded, so the
  // step in the address is not rewritten before it arrives.
  const restoringRef = useRef(Boolean(submissionId));
  // Until the saved proposal has loaded, an edit page shows a skeleton
  // rather than an empty form that then jumps.
  const [loadingSubmission, setLoadingSubmission] = useState(Boolean(submissionId));
  const [isSaving, setIsSaving] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  /*
    FR5.8 — "the status shows ... on each submission", and FR5.2 — a
    submission sent back "returns to its owner to edit and resubmit". The
    form itself has no status (it is never client-settable), so the open
    submission's status and send-back reason are held alongside it.
  */
  const [submissionMeta, setSubmissionMeta] = useState<{
    status: AmcSubmissionStatus;
    sentBackReason: string | null;
    clientReason?: string | null;
    clientName?: string | null;
  } | null>(null);
  /*
    FR6.2/FR6.4 — the live settings a draft renders with. Undefined until
    loaded, in which case computeAmcData falls back to the shipped
    defaults; a failed load is reported rather than silently previewing
    text the client may never be sent.
  */
  const [liveSettings, setLiveSettings] = useState<AmcSettings | undefined>();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const activeSavesRef = useRef(0);
  const wizardRef = useRef<HTMLDivElement>(null);
  const pendingScrollRef = useRef(false);

  const defaultValues = useMemo(() => getDefaultFormValues(), []);

  const form = useForm<AmcFormData>({
    resolver: zodResolver(amcFormSchema) as never,
    defaultValues,
    mode: "onChange",
  });

  const unitType = form.watch("unitType");
  const watchedValues = form.watch();
  const computed = useMemo(
    () => computeAmcData(watchedValues, "proposal", liveSettings),
    [watchedValues, liveSettings],
  );

  /*
    Loaded when the wizard opens and again whenever Review & Submit opens:
    an admin may have changed AMC Settings in the meantime, and the review
    is where the team reads the wording before it goes out.
  */
  const onReviewStep = currentStep === STEPS.length;
  useEffect(() => {
    let cancelled = false;
    amcSettingsService
      .getSettings()
      .then((response) => {
        if (!cancelled) setLiveSettings(response.settings);
      })
      .catch((error) => {
        console.error(error);
        toast.error(
          "Couldn't load the latest AMC Settings, so the preview may show the default wording. Reload the page before you send anything.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [onReviewStep]);

  const loadSubmission = useCallback(
    async (submissionId: string, step = 1) => {
      try {
        const submission =
          await amcSubmissionsService.getSubmission(submissionId);
        form.reset(submissionToFormData(submission));
        setSubmissionMeta({
          status: submission.status,
          sentBackReason: submission.sent_back_reason ?? null,
          clientReason: submission.client_rejected_reason ?? null,
          clientName: submission.client_decided_by_name ?? null,
        });
        setCurrentStep(Math.min(Math.max(step, 1), STEPS.length));
        /* A saved submission has been through the steps already. */
        setFurthestStep(STEPS.length);
      } catch (error) {
        console.error(error);
        toast.error(
          getErrorMessage(
            error,
            "Couldn't open this submission. It may have been deleted, or you may not have access to it.",
          ),
        );
      }
    },
    [form],
  );

  // Open the proposal the address names, on the step it names.
  useEffect(() => {
    if (!submissionId) return;
    void loadSubmission(submissionId, initialStep.current).finally(() => {
      restoringRef.current = false;
      setLoadingSubmission(false);
    });
  }, [submissionId, loadSubmission]);

  const openSubmissionId = form.watch("submissionId");
  /*
    Keep the address in step with the screen, WITHOUT a navigation.

    A new proposal gets its id when the first draft saves; the address
    then becomes /extensions/amc/<id>/edit, so a reload reopens it. A
    router navigation would unmount the form -- and with it any autosave
    still in flight -- so the history entry is replaced in place, which
    the App Router picks up.
  */
  useEffect(() => {
    if (restoringRef.current) return;
    const path = openSubmissionId
      ? `/extensions/amc/${openSubmissionId}/edit`
      : "/extensions/amc/new";
    const next = currentStep > 1 ? `${path}?step=${currentStep}` : path;
    if (`${window.location.pathname}${window.location.search}` !== next) {
      window.history.replaceState(window.history.state, "", next);
    }
  }, [currentStep, openSubmissionId]);

  // The breadcrumb names the proposal by its customer, not its id.
  const customerName = form.watch("customerName");
  useBreadcrumbLabel(openSubmissionId || undefined, customerName || "Proposal");
  useBreadcrumbLabel("amc", "AMC proposals");
  useBreadcrumbLabel("new", "New proposal");

  useEffect(() => {
    if (!pendingScrollRef.current) return;
    pendingScrollRef.current = false;

    requestAnimationFrame(() => {
      scrollWizardContainerToTop(wizardRef.current);
    });
  }, [currentStep]);

  useEffect(() => {
    const currentRows = form.getValues("serviceRows");
    const synced = syncServiceRowsForUnitType(currentRows, unitType);
    const currentJson = JSON.stringify(currentRows);
    const syncedJson = JSON.stringify(synced);
    if (currentJson !== syncedJson) {
      form.setValue("serviceRows", synced, { shouldValidate: true });
    }
  }, [unitType, form]);

  const persistDraft = useCallback(
    (generatedDocument?: AmcDocumentType) => {
      activeSavesRef.current += 1;
      setIsSaving(true);
      /*
        Resolves to whether THIS save landed, so Submit can stop on a failed
        one instead of submitting the previous version. The queue itself
        always resolves, so one failed save does not block the next.
      */
      const save: Promise<boolean> = saveQueueRef.current
        .then(async () => {
          const values = form.getValues();
          const payload = formDataToSubmissionPayload(
            values,
            generatedDocument ? [generatedDocument] : undefined,
          );

          if (values.submissionId) {
            const updated = await amcSubmissionsService.updateSubmission({
              id: values.submissionId,
              ...payload,
            });
            form.setValue("submissionId", updated.id, { shouldDirty: false });
            return true;
          }

          const created = await amcSubmissionsService.createSubmission(payload);
          form.setValue("submissionId", created.id, { shouldDirty: false });
          setSubmissionMeta({ status: created.status, sentBackReason: null });
          /* Step 1.7 — the number is allocated by the INSERT, so it is only
             known once this returns. */
          form.setValue("proposalNumber", created.customer.proposalNumber, {
            shouldDirty: false,
          });
          return true;
        })
        .catch((error) => {
          console.error(error);
          toast.error(
            getErrorMessage(
              error,
              "Couldn't save your draft. Check your connection and try again.",
            ),
          );
          return false;
        })
        .finally(() => {
          activeSavesRef.current -= 1;
          if (activeSavesRef.current === 0) {
            setIsSaving(false);
          }
        });
      saveQueueRef.current = save.then(() => undefined);
      return save;
    },
    [form],
  );

  const saveAndNavigate = useCallback(
    async (targetStep: number, requireValidation: boolean) => {
      if (targetStep === currentStep) return;

      if (requireValidation) {
        const fields = STEP_FIELDS[currentStep] ?? [];
        const isValid = fields.length === 0 ? true : await form.trigger(fields);

        if (!isValid) {
          toast.error(
            STEP_VALIDATION_MESSAGES[currentStep] ??
              "Please complete all required fields before continuing.",
          );
          return;
        }
      }

      setCurrentStep(targetStep);
      setFurthestStep((furthest) => Math.max(furthest, targetStep));
      pendingScrollRef.current = true;

      const isForward = targetStep > currentStep;
      const hasSubmission = Boolean(form.getValues("submissionId"));
      if (isForward || hasSubmission) {
        persistDraft();
      }
    },
    [currentStep, form, persistDraft],
  );

  const handleNext = () => {
    void saveAndNavigate(Math.min(currentStep + 1, STEPS.length), true);
  };

  const handleBack = () => {
    void saveAndNavigate(Math.max(currentStep - 1, 1), false);
  };

  /*
    Any step reached so far can be clicked. Going back needs no checks.
    Going forward checks every step being skipped, in order, and stops on
    the first one with something missing -- so a jump ahead can never
    carry a half-filled step into Review & Submit.
  */
  const handleStepClick = async (stepId: number) => {
    if (stepId === currentStep || stepId > furthestStep) return;
    if (stepId < currentStep) {
      void saveAndNavigate(stepId, false);
      return;
    }
    for (let step = currentStep; step < stepId; step++) {
      const fields = STEP_FIELDS[step] ?? [];
      const isValid = fields.length === 0 ? true : await form.trigger(fields);
      if (!isValid) {
        toast.error(
          STEP_VALIDATION_MESSAGES[step] ??
            "Please complete all required fields before continuing.",
        );
        if (step !== currentStep) void saveAndNavigate(step, false);
        return;
      }
    }
    void saveAndNavigate(stepId, false);
  };

  /*
    FR5.1 — submit for internal review. The wizard's terminal action; the
    two "generate" buttons it replaces are gone (FR2.13).

    The draft is flushed first: the autosave queue may still be mid-write,
    and submitting a proposal the server has not seen the latest edits of
    would put the previous version in front of the approver.
  */
  const handleSubmitForApproval = async () => {
    const isValid = await form.trigger();
    if (!isValid) {
      toast.error(
        "Finish every step before you submit this proposal for approval.",
      );
      return;
    }
    if (
      !(await confirm({
        title: "Submit for approval?",
        description:
          "The approver will review this proposal. You can't edit it while it's waiting, and nothing goes to the client until it's approved.",
        confirmText: "Submit for approval",
      }))
    ) {
      return;
    }

    setIsSubmitting(true);
    let leaving = false;
    try {
      // A failed save has already said so; submitting now would send the
      // approver the previous version.
      if (!(await persistDraft())) return;

      const submissionId = form.getValues("submissionId");
      if (!submissionId) throw new Error("The draft hasn't been saved yet.");

      await amcSubmissionsService.decide({
        action: "submit",
        id: submissionId,
      });
      /*
        This used to rebuild the form from the approval route's reply --
        which carries only the fields the transition changed, not a whole
        submission. submissionToFormData then read reply.property and
        crashed ("Cannot read properties of undefined (reading
        'propertyCategory')") AFTER the server had already accepted the
        submit, so a submitted proposal looked like a failure.

        The proposal is locked now anyway (FR3.4), so the wizard starts
        fresh and the list shows it as Awaiting approval.
      */
      toast.success(
        "Sent for approval. Nothing goes to the client until the approver has reviewed it.",
      );
      // Its own page: what was sent, and where it stands now. The button
      // stays busy until that page replaces this one.
      leaving = true;
      router.push(`/extensions/amc/${submissionId}`);
    } catch (error) {
      console.error(error);
      toast.error(
        getErrorMessage(error, "Couldn't submit this proposal for approval."),
      );
    } finally {
      if (!leaving) setIsSubmitting(false);
    }
  };

  /*
    Saves the document as a file, PDF or Word, without opening the
    viewer: the preview already shows what it contains.
  */
  const [downloading, setDownloading] = useState<string | null>(null);
  /* Which document the preview popup is showing, or null when closed. */
  const [previewDoc, setPreviewDoc] = useState<AmcDocumentType | null>(null);
  const handleDownload = async (
    documentType: AmcDocumentType,
    format: "pdf" | "docx",
  ) => {
    const isValid = await form.trigger();
    if (!isValid) {
      toast.error(
        "Fill in the required fields on every step before you download a document.",
      );
      return;
    }
    setDownloading(`${documentType}:${format}`);

    /*
      One toast for the whole build, updated as it goes. A contract PDF is
      eight or nine pages captured one at a time, which takes a while and
      holds the browser between pages, so a spinner alone stutters and
      looks stuck. Saying which page it is on shows it is moving.
    */
    const noun = documentType === "proposal" ? "proposal" : "contract";
    const kind = format === "pdf" ? "PDF" : "Word file";
    const toastId = toast.loading(`Preparing the ${noun} ${kind}…`, {
      description:
        format === "pdf" ? "Laying out the pages." : "Building the document.",
    });
    try {
      const { blob, filename } = await buildAmcPdf(
        form.getValues(),
        documentType,
        liveSettings,
        null,
        format,
        (progress) => {
          toast.loading(`Preparing the ${noun} ${kind}…`, {
            id: toastId,
            description:
              progress.stage === "layout"
                ? "Laying out the pages."
                : progress.stage === "page"
                  ? `Rendering page ${progress.page} of ${progress.total}.`
                  : "Saving the file.",
          });
        },
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success(
        `${noun.charAt(0).toUpperCase()}${noun.slice(1)} ${kind} downloaded`,
        {
          id: toastId,
          description: filename,
        },
      );
    } catch (error) {
      console.error(error);
      toast.error(`Could not build the ${noun} ${kind}`, {
        id: toastId,
        description:
          error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setDownloading(null);
    }
  };

  const renderStep = () => {
    switch (currentStep) {
      case 1:
        return <PropertyCustomerStep form={form} />;
      case 2:
        return <ServicesPricingStep form={form} />;
      case 3:
        return (
          <ReviewStep form={form} computed={computed} />
        );
      default:
        return null;
    }
  };

  const isReviewStep = currentStep === STEPS.length;

  /*
    The same page shape as the snagging module: the house heading, then
    the view switcher, then the work in one card -- the form's steps as
    titled sections and its buttons in a footer, not cards inside a card.
  */
  const editing = Boolean(openSubmissionId);

  /* Both documents, worded with the live AMC Settings, for the preview. */
  const previewData = useMemo(
    () => ({
      proposal: computeAmcData(watchedValues, "proposal", liveSettings),
      contract: computeAmcData(watchedValues, "contract", liveSettings),
    }),
    [watchedValues, liveSettings],
  );

  return (
    <div ref={wizardRef} className="flex w-full flex-1 flex-col gap-6">
      <PageHeading
        eyebrow="AMC proposals"
        title={
          editing
            ? customerName || "Untitled proposal"
            : "New AMC proposal"
        }
        description={
          editing
            ? "Your changes save as a draft each time you move between steps."
            : "Fill in the property, the services and the prices, then submit it for approval."
        }
        actions={
          <div className="flex items-center gap-3">
            {/*
              The wizard saves a draft on every step change. Without this the
              save is entirely silent, which is the wrong reassurance to give
              about the one feature whose whole point is that closing the
              browser does not lose your work.
            */}
            {isSaving ? (
              <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
                <Loader2 className="size-3 animate-spin" />
                Saving draft…
              </span>
            ) : null}
            <Button variant="outline" asChild>
              <Link href="/extensions/amc">
                <ArrowLeft className="size-4" />
                All proposals
              </Link>
            </Button>
          </div>
        }
      />

      {confirmDialog}

      {/* The documents on screen, from the Review step's Preview buttons. */}
      <AmcPreviewDialog
        open={previewDoc !== null}
        onOpenChange={(open) => !open && setPreviewDoc(null)}
        title={[customerName || "New proposal", watchedValues.proposalNumber]
          .filter(Boolean)
          .join(" · ")}
        documentType={previewDoc ?? "proposal"}
        onDocumentTypeChange={setPreviewDoc}
        data={previewData}
        downloading={downloading !== null}
        onDownload={(documentType, format) => void handleDownload(documentType, format)}
      />

      {submissionMeta && (
        <SubmissionStatusBanner
          status={submissionMeta.status}
          sentBackReason={submissionMeta.sentBackReason}
          clientReason={submissionMeta.clientReason}
          clientName={submissionMeta.clientName}
          proposalNumber={watchedValues.proposalNumber}
        />
      )}

      {loadingSubmission ? (
        <>
          {/* Mirrors the real layout: the steps sit above the card. */}
          <div className="bg-muted mb-4 h-8 w-72 animate-pulse rounded-full" />
          <Card className="p-6">
            <div className="grid gap-4 sm:grid-cols-2">
              {Array.from({ length: 6 }, (_, index) => (
                <div key={index} className="bg-muted h-10 animate-pulse rounded-md" />
              ))}
            </div>
          </Card>
        </>
      ) : (
        <Form {...form}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!isReviewStep) {
                handleNext();
              }
            }}
          >
            {/* Where you are in the three steps. Outside the card, so it
                reads as navigation over the form rather than as the form's
                own first row. */}
            <div className="mb-4 flex flex-wrap gap-2">
              {STEPS.map((step) => {
                const isActive = step.id === currentStep;
                /* Reached already: clickable, marked done. */
                const isComplete = !isActive && step.id <= furthestStep;

                return (
                  <button
                    key={step.id}
                    type="button"
                    disabled={step.id > furthestStep}
                    onClick={() => void handleStepClick(step.id)}
                    className={cn(
                      "inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
                      isActive && "border-brand bg-brand text-white",
                      isComplete &&
                        "border-brand/30 bg-brand-50 text-brand hover:bg-brand-50/70 cursor-pointer",
                      !isActive &&
                        !isComplete &&
                        "border-border text-muted-foreground cursor-default opacity-70",
                    )}
                  >
                    {isComplete ? <Check className="size-3.5 shrink-0" /> : null}
                    {step.title}
                  </button>
                );
              })}
            </div>

            <Card className="gap-0 p-0">
              <div className="space-y-6 p-4 sm:p-6">{renderStep()}</div>

              <div className="flex flex-col-reverse gap-2 border-t px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleBack}
                  disabled={currentStep === 1}
                  className="w-full sm:w-auto"
                >
                  Back
                </Button>

                {!isReviewStep ? (
                  <Button type="submit" className="w-full min-w-[110px] sm:w-auto">
                    Continue
                  </Button>
                ) : (
                  <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                    {/* Both documents, exactly as the client gets them. */}
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setPreviewDoc("proposal")}
                      className="w-full sm:w-auto"
                    >
                      <FileText className="size-4" />
                      Preview proposal
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setPreviewDoc("contract")}
                      className="w-full sm:w-auto"
                    >
                      <ScrollText className="size-4" />
                      Preview contract
                    </Button>
                    {/* FR5.1 — the only way out of the wizard. Nothing
                        reaches the client before internal approval. */}
                    <Button
                      type="button"
                      onClick={() => void handleSubmitForApproval()}
                      disabled={isSubmitting}
                      className="w-full gap-2 sm:w-auto"
                    >
                      {isSubmitting ? (
                        <>
                          <Loader2 className="size-4 animate-spin" />
                          Submitting…
                        </>
                      ) : (
                        <>
                          <SendHorizonal className="size-4" />
                          Submit for approval
                        </>
                      )}
                    </Button>
                  </div>
                )}
              </div>
            </Card>
          </form>
        </Form>
      )}
    </div>
  );
}
