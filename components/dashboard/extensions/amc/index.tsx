"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import {
  Check,
  ClipboardList,
  FileText,
  Loader2,
  Plus,
  ScrollText,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Form } from "@/components/ui/form";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { amcSubmissionsService } from "@/modules/amc-submissions";

import {
  getDefaultFormValues,
} from "./amc-constants";
import { formDataToSubmissionPayload, submissionToFormData } from "./amc-submission-mapper";
import { downloadAmcPdf } from "./amc-document-utils";
import { computeAmcData, syncServiceRowsForUnitType } from "./amc-pricing";
import { amcFormSchema, type AmcDocumentType, type AmcFormData } from "./amc-types";
import { PropertyCustomerStep } from "./steps/property-customer-step";
import { PackageServicesStep } from "./steps/package-services-step";
import { ReviewStep } from "./steps/review-step";
import { SubmissionsList } from "./submissions-list";

const STEPS = [
  {
    id: 1,
    title: "Property & Customer",
    description: "Property, client, and contract details",
  },
  {
    id: 2,
    title: "Package & Services",
    description: "Package selection and service table",
  },
  {
    id: 3,
    title: "Review & Generate",
    description: "Summary and document generation",
  },
] as const;

const STEP_FIELDS: Partial<Record<number, (keyof AmcFormData)[]>> = {
  1: [
    "propertyCategory",
    "unitType",
    "propertyAddress",
    "propertyDetail",
    "customerName",
    "customerPhone",
    "customerEmail",
    "startDate",
    "endDate",
    "paymentTerms",
    "proposalNumber",
    "coordinationContacts",
  ],
  2: ["packageId", "customMonthlyPrice", "serviceRows", "discountPercent"],
};

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

const STEP_VALIDATION_MESSAGES: Record<number, string> = {
  1: "Please complete all property, customer, and contract fields before continuing.",
  2: "Please select a package, choose at least one service, and complete the service table before continuing.",
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

interface AmcContractsPageProps {
  initialSubmissionId?: string;
}

export function AmcContractsPage({
  initialSubmissionId,
}: AmcContractsPageProps = {}) {
  const [activeTab, setActiveTab] = useState<"create" | "submissions">("create");
  const [currentStep, setCurrentStep] = useState(1);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatingType, setGeneratingType] = useState<AmcDocumentType | null>(
    null,
  );
  const [isSaving, setIsSaving] = useState(false);
  const [listRefreshKey, setListRefreshKey] = useState(0);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const activeSavesRef = useRef(0);
  const wizardRef = useRef<HTMLDivElement>(null);
  const pendingScrollRef = useRef(false);
  const toastId = "dashboard-amc-download-pdf";

  const defaultValues = useMemo(() => getDefaultFormValues(), []);

  const form = useForm<AmcFormData>({
    resolver: zodResolver(amcFormSchema) as never,
    defaultValues,
    mode: "onChange",
  });

  const unitType = form.watch("unitType");
  const packageId = form.watch("packageId");
  const propertyCategory = form.watch("propertyCategory");
  const watchedValues = form.watch();
  const computed = useMemo(
    () => computeAmcData(watchedValues, "proposal"),
    [watchedValues],
  );

  const loadSubmission = useCallback(
    async (submissionId: string) => {
      try {
        const submission =
          await amcSubmissionsService.getSubmission(submissionId);
        form.reset(submissionToFormData(submission));
        setActiveTab("create");
        setCurrentStep(1);
      } catch (error) {
        console.error(error);
        toast.error(
          getErrorMessage(
            error,
            "Unable to load this submission. It may have been deleted or you may not have access.",
          ),
        );
      }
    },
    [form],
  );

  useEffect(() => {
    if (initialSubmissionId) {
      void loadSubmission(initialSubmissionId);
    }
  }, [initialSubmissionId, loadSubmission]);

  useEffect(() => {
    if (!pendingScrollRef.current) return;
    pendingScrollRef.current = false;

    requestAnimationFrame(() => {
      scrollWizardContainerToTop(wizardRef.current);
    });
  }, [currentStep]);

  useEffect(() => {
    const currentRows = form.getValues("serviceRows");
    const synced = syncServiceRowsForUnitType(
      currentRows,
      unitType,
      packageId,
      propertyCategory,
    );
    const currentJson = JSON.stringify(currentRows);
    const syncedJson = JSON.stringify(synced);
    if (currentJson !== syncedJson) {
      form.setValue("serviceRows", synced, { shouldValidate: true });
    }
  }, [unitType, packageId, propertyCategory, form]);

  const persistDraft = useCallback(
    (markGenerated?: AmcDocumentType) => {
      activeSavesRef.current += 1;
      setIsSaving(true);
      saveQueueRef.current = saveQueueRef.current
        .then(async () => {
          const values = form.getValues();
          const payload = formDataToSubmissionPayload(
            values,
            markGenerated ? "generated" : "draft",
            markGenerated ? [markGenerated] : undefined,
          );

          if (values.submissionId) {
            const updated = await amcSubmissionsService.updateSubmission({
              id: values.submissionId,
              ...payload,
            });
            form.setValue("submissionId", updated.id, { shouldDirty: false });
            return;
          }

          const created = await amcSubmissionsService.createSubmission(payload);
          form.setValue("submissionId", created.id, { shouldDirty: false });
        })
        .catch((error) => {
          console.error(error);
          toast.error(
            getErrorMessage(
              error,
              "Failed to save your draft. Please check your connection and try again.",
            ),
          );
        })
        .finally(() => {
          activeSavesRef.current -= 1;
          if (activeSavesRef.current === 0) {
            setIsSaving(false);
          }
          setListRefreshKey((key) => key + 1);
        });
    },
    [form],
  );

  const saveAndNavigate = useCallback(
    async (targetStep: number, requireValidation: boolean) => {
      if (targetStep === currentStep) return;

      if (requireValidation) {
        const fields = STEP_FIELDS[currentStep] ?? [];
        const isValid =
          fields.length === 0 ? true : await form.trigger(fields);

        if (!isValid) {
          toast.error(
            STEP_VALIDATION_MESSAGES[currentStep] ??
            "Please complete all required fields before continuing.",
          );
          return;
        }
      }

      setCurrentStep(targetStep);
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

  const handleStepClick = (stepId: number) => {
    if (stepId >= currentStep) return;
    void saveAndNavigate(stepId, false);
  };

  const handleGenerate = async (documentType: AmcDocumentType) => {
    const isValid = await form.trigger();
    if (!isValid) {
      toast.error(
        "Please complete all required fields in every step before generating a document.",
      );
      return;
    }

    setIsGenerating(true);
    setGeneratingType(documentType);
    toast.loading(
      documentType === "proposal"
        ? "Generating proposal..."
        : "Generating contract...",
      { id: toastId },
    );

    try {
      const values = form.getValues();
      await downloadAmcPdf(values, documentType);

      persistDraft(documentType);
      toast.success(
        documentType === "proposal"
          ? "Proposal downloaded successfully!"
          : "Contract downloaded successfully!",
      );
    } catch (error) {
      console.error(error);
      toast.error(
        getErrorMessage(
          error,
          documentType === "proposal"
            ? "Failed to generate the proposal PDF. Please try again."
            : "Failed to generate the contract PDF. Please try again.",
        ),
      );
    } finally {
      setIsGenerating(false);
      setGeneratingType(null);
      toast.dismiss(toastId);
    }
  };

  const handleNewSubmission = () => {
    form.reset(getDefaultFormValues());
    setCurrentStep(1);
    setActiveTab("create");
  };

  const handleEditSubmission = (submissionId: string) => {
    void loadSubmission(submissionId);
  };

  const renderStep = () => {
    switch (currentStep) {
      case 1:
        return <PropertyCustomerStep form={form} />;
      case 2:
        return <PackageServicesStep form={form} />;
      case 3:
        return <ReviewStep form={form} computed={computed} />;
      default:
        return null;
    }
  };

  const isReviewStep = currentStep === STEPS.length;

  return (
    <Card ref={wizardRef} className="w-full flex-1 relative top-px right-px gap-6">
      {/* <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex flex-col gap-1">
          <CardTitle className="text-xl flex items-center gap-2">
            <ClipboardList className="size-5 text-primary" />
            AMC Proposals
          </CardTitle>
          <CardDescription>
            Build annual maintenance contract proposals, manage submissions, and
            generate proposal or contract PDFs.
          </CardDescription>
        </div>
        {isSaving && (
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Loader2 className="size-3 animate-spin" />
            Saving draft...
          </span>
        )}
      </CardHeader> */}

      <div className="print:hidden px-4">
        <p className="eyebrow">Extension</p>
        <h1 className="mt-1.5 text-3xl">AMC Proposals</h1>
        <p className="text-muted-foreground mt-1 text-[0.9375rem]">
          Build annual maintenance contract proposals, manage submissions, and
          generate proposal or contract PDFs.        </p>
      </div>

      <CardContent className="space-y-4">
        <Tabs
          value={activeTab}
          onValueChange={(value) =>
            setActiveTab(value as "create" | "submissions")
          }
          className="w-full gap-0"
        >
          <TabsList className="mb-4 w-full sm:w-auto">
            <TabsTrigger value="create" className="flex items-center gap-2">
              <Plus className="size-4" />
              Create New
            </TabsTrigger>
            <TabsTrigger value="submissions" className="flex items-center gap-2">
              <ScrollText className="size-4" />
              My Submissions
            </TabsTrigger>
          </TabsList>

          <TabsContent value="create" className="space-y-5 mt-0">
            <div className="flex flex-wrap gap-2">
              {STEPS.map((step) => {
                const isActive = step.id === currentStep;
                const isComplete = step.id < currentStep;

                return (
                  <button
                    key={step.id}
                    type="button"
                    disabled={step.id > currentStep}
                    onClick={() => handleStepClick(step.id)}
                    className={cn(
                      "flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs transition-colors",
                      isActive &&
                      "border-primary bg-primary/10 text-primary font-medium",
                      isComplete &&
                      "border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 cursor-pointer",
                      !isActive &&
                      !isComplete &&
                      "border-border text-muted-foreground opacity-70 cursor-default",
                    )}
                  >
                    {isComplete ? (
                      <Check className="size-3 shrink-0" />
                    ) : (
                      <span className="flex size-4 shrink-0 items-center justify-center rounded-full border text-[10px] font-medium">
                        {step.id}
                      </span>
                    )}
                    {step.title}
                  </button>
                );
              })}
            </div>

            <Form {...form}>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!isReviewStep) {
                    handleNext();
                  }
                }}
                className="space-y-6"
              >
                {renderStep()}

                <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-between">
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
                    <Button
                      type="submit"
                      className="w-full sm:w-auto min-w-[110px]"
                    >
                      Continue
                    </Button>
                  ) : (
                    <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void handleGenerate("proposal")}
                        disabled={isGenerating}
                        className="w-full sm:w-auto min-w-[160px] gap-2"
                      >
                        {isGenerating && generatingType === "proposal" ? (
                          <>
                            <Loader2 className="size-4 animate-spin" />
                            Generating…
                          </>
                        ) : (
                          <>
                            <FileText className="size-4" />
                            Generate Proposal
                          </>
                        )}
                      </Button>
                      <Button
                        type="button"
                        onClick={() => void handleGenerate("contract")}
                        disabled={isGenerating}
                        className="w-full sm:w-auto min-w-[160px] gap-2"
                      >
                        {isGenerating && generatingType === "contract" ? (
                          <>
                            <Loader2 className="size-4 animate-spin" />
                            Generating…
                          </>
                        ) : (
                          <>
                            <ScrollText className="size-4" />
                            Generate Contract
                          </>
                        )}
                      </Button>
                    </div>
                  )}
                </div>
              </form>
            </Form>
          </TabsContent>

          <TabsContent value="submissions" className="mt-0">
            <SubmissionsList
              refreshKey={listRefreshKey}
              onEdit={handleEditSubmission}
              onCreateNew={handleNewSubmission}
            />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
