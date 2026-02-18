"use client";

import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  LoaderCircleIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { rolesService } from "@/modules/roles";
import { toast } from "sonner";

interface RoleDataTableToolbarProps {
  fetchRecords: () => void;
  onGlobalFilterChange: (filter: string) => void;
  isSearchLoading: boolean;
  pageSize: number;
  onPageSizeChange: (size: number) => void;
}

const formSchema = z.object({
  name: z.string().min(1, { message: "Name is required" }),
  description: z.string().optional(),
});

export function RoleDataTableToolbar({
  fetchRecords,
  onGlobalFilterChange,
  isSearchLoading,
  pageSize,
  onPageSizeChange,
}: RoleDataTableToolbarProps) {
  const searchInputId = useId();
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const [globalFilter, setGlobalFilter] = useState<string>("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      description: "",
    },
  });

  const handleFilterChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setGlobalFilter(value);
    onGlobalFilterChange?.(value);
  };

  const onSubmit = async (data: z.infer<typeof formSchema>) => {
    try {
      setIsSubmitting(true);
      const result = await rolesService.createRole(data.name, data.description);
      if (!result) {
        throw new Error("Failed to create role");
      }
      toast.success("Role created successfully");
      setIsDialogOpen(false);
      form.reset();
      fetchRecords();
    } catch (error) {
      console.error("Error creating role:", error);
      toast.error("Failed to create role");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex gap-2 sm:gap-4 py-4 sm:py-6 px-4 flex-row items-center justify-between">
      {/* Search Input */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 sm:min-w-[260px] sm:max-w-md">
          <Input
            id={searchInputId}
            ref={searchInputRef}
            type="search"
            placeholder="Search roles..."
            className="peer ps-9 w-full"
            value={globalFilter}
            onChange={handleFilterChange}
          />
          <div className="pointer-events-none absolute inset-y-0 start-0 flex items-center justify-center ps-3 text-muted-foreground/80 peer-disabled:opacity-50">
            {isSearchLoading ? (
              <LoaderCircleIcon
                aria-label="Loading..."
                className="animate-spin"
                role="status"
                size={16}
              />
            ) : (
              <SearchIcon aria-hidden="true" size={16} />
            )}
          </div>
        </div>
      </div>

      {/* Controls Section */}
      <div className="flex gap-3 sm:flex-row sm:items-center sm:gap-4">
        {/* Page Size Selector */}
        <div className="hidden sm:flex items-center gap-2 w-full sm:w-auto">
          <Label htmlFor="#roleRowSelect" className="sr-only">
            Show
          </Label>
          <Select
            value={pageSize?.toString() || "10"}
            onValueChange={(value) => {
              onPageSizeChange(Number(value));
            }}
          >
            <SelectTrigger
              id="roleRowSelect"
              className="w-full sm:w-fit whitespace-nowrap"
            >
              <SelectValue placeholder="Select number of results" />
            </SelectTrigger>
            <SelectContent className="[&_*[role=option]]:pr-8 [&_*[role=option]]:pl-2 [&_*[role=option]>span]:right-2 [&_*[role=option]>span]:left-auto">
              {[10, 25, 50].map((size) => (
                <SelectItem key={size} value={size.toString()}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <Button onClick={fetchRecords} variant="outline" type="button">
            <RefreshCwIcon className="size-4 sm:mr-1" />
            <span className="hidden sm:inline">Refresh</span>
          </Button>

          <Button
            type="button"
            onClick={() => setIsDialogOpen(true)}
            className="flex-1 sm:flex-initial"
          >
            <PlusIcon className="size-4 sm:mr-2" />
            <span className="hidden sm:inline">Add Role</span>
          </Button>
        </div>
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="flex flex-col gap-0 overflow-y-visible p-0 sm:max-w-lg [&>button:last-child]:top-3.5">
          <DialogHeader className="contents space-y-0 text-left">
            <DialogTitle className="border-b px-6 py-4 text-base">
              Add New Role
            </DialogTitle>
          </DialogHeader>
          <div className="overflow-y-auto max-h-[80vh]">
            <div className="px-6 pt-4 pb-6">
              <Form {...form}>
                <form
                  onSubmit={form.handleSubmit(onSubmit)}
                  className="space-y-4"
                >
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem className="space-y-1 flex flex-col gap-1">
                        <FormLabel>Name</FormLabel>
                        <FormControl>
                          <Input placeholder="Enter role name" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem className="space-y-1 flex flex-col gap-1">
                        <FormLabel>Description</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="Enter description (optional)"
                            className="resize-none"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <DialogFooter className="border-t px-0 pt-4">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setIsDialogOpen(false)}
                      disabled={isSubmitting}
                    >
                      Cancel
                    </Button>
                    <Button type="submit" disabled={isSubmitting}>
                      {isSubmitting ? "Creating..." : "Create Role"}
                    </Button>
                  </DialogFooter>
                </form>
              </Form>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
