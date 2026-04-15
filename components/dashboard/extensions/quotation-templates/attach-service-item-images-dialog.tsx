"use client";

import { useRef } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ServiceItemImage } from "./quotation-templates";

export type ServiceItemOption = {
  id: string;
  label: string;
};

export type ImagePreviewItem = {
  key: string;
  name: string;
  url: string;
};

type Props = {
  open: boolean;
  onOpenChangeAction: (open: boolean) => void;
  serviceItemOptions: ServiceItemOption[];
  selectedServiceItemId: string;
  onSelectServiceItemAction: (value: string) => void;
  onFileChangeAction: React.ChangeEventHandler<HTMLInputElement>;
  remainingAfterSelection: number;
  selectedImagePreviews: ImagePreviewItem[];
  selectedServiceItemImages: ServiceItemImage[];
  onRemoveSelectedImageAction: (previewKey: string) => void;
  onDeleteUploadedImageAction: (imageUrl: string) => void;
  deletingImageUrl: string | null;
  isUploadingServiceItemImages: boolean;
  onUploadAction: () => void;
  uploadDisabled: boolean;
};

export function AttachServiceItemImagesDialog({
  open,
  onOpenChangeAction,
  serviceItemOptions,
  selectedServiceItemId,
  onSelectServiceItemAction,
  onFileChangeAction,
  remainingAfterSelection,
  selectedImagePreviews,
  selectedServiceItemImages,
  onRemoveSelectedImageAction,
  onDeleteUploadedImageAction,
  deletingImageUrl,
  isUploadingServiceItemImages,
  onUploadAction,
  uploadDisabled,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const canChooseFiles = Boolean(selectedServiceItemId) && remainingAfterSelection > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChangeAction}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Attach Service Item Images</DialogTitle>
          <DialogDescription>
            Select a service item and upload up to 2 images for it.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="service-item-id">Service item</Label>
            <Select value={selectedServiceItemId} onValueChange={onSelectServiceItemAction}>
              <SelectTrigger
                id="service-item-id"
                className="w-[388px] "
              >
                <SelectValue placeholder="Select service item" />
              </SelectTrigger>
              <SelectContent className="w-full">
                {serviceItemOptions.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="service-item-images">Images (max 2)</Label>
            <Input
              ref={fileInputRef}
              id="service-item-images"
              type="file"
              accept="image/*"
              multiple
              onChange={onFileChangeAction}
              disabled={!canChooseFiles}
              className="sr-only"
            />
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={!canChooseFiles}
              >
                Choose images
              </Button>
              <p className="text-xs text-muted-foreground">
                {canChooseFiles
                  ? `You can add ${remainingAfterSelection} more image${remainingAfterSelection === 1 ? "" : "s"}`
                  : "Image limit reached for this service item"}
              </p>
            </div>
          </div>
          {(selectedImagePreviews.length > 0 ||
            selectedServiceItemImages.length > 0) && (
              <div className="space-y-2">
                <Label>Attachments</Label>
                <div className="grid max-h-[320px] grid-cols-2 gap-2 overflow-y-auto pr-1">
                  {selectedImagePreviews.map((preview) => (
                    <div
                      key={preview.key}
                      className="relative overflow-hidden rounded-md border border-dashed h-max"
                    >
                      <img
                        src={preview.url}
                        alt={preview.name}
                        className="h-auto w-full object-cover"
                      />
                      <div className="flex items-center justify-between gap-1 px-1 py-1">
                        <p className="truncate text-[10px] text-muted-foreground">
                          {preview.name}
                        </p>
                        <Badge variant="outline" className="h-4 px-1 text-[9px]">
                          Selected
                        </Badge>
                      </div>
                      <Button
                        type="button"
                        size="icon"
                        variant="destructive"
                        className="absolute right-1 top-1 size-6"
                        onClick={() => onRemoveSelectedImageAction(preview.key)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  ))}
                  {selectedServiceItemImages.map((image) => (
                    <div
                      key={image.supabaseUrl}
                      className="relative overflow-hidden rounded-md border h-max"
                    >
                      <a
                        href={image.supabaseUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block"
                      >
                        <img
                          src={image.supabaseUrl}
                          alt="Service item attachment"
                          className="h-auto w-full object-cover"
                        />
                      </a>
                      <Badge
                        variant="secondary"
                        className="absolute bottom-1 left-1 h-4 px-1 text-[9px]"
                      >
                        Uploaded
                      </Badge>
                      <Button
                        type="button"
                        size="icon"
                        variant="destructive"
                        className="absolute right-1 top-1 size-6"
                        disabled={deletingImageUrl === image.supabaseUrl}
                        onClick={() => onDeleteUploadedImageAction(image.supabaseUrl)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChangeAction(false)}
            disabled={isUploadingServiceItemImages}
          >
            Cancel
          </Button>
          <Button
            onClick={onUploadAction}
            disabled={uploadDisabled}
          >
            {isUploadingServiceItemImages ? "Uploading..." : "Upload Images"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
