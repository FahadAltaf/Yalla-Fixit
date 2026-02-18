import { ColumnDef } from "@tanstack/react-table";

import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

import {
  ArmchairIcon,
  EllipsisVerticalIcon,
  Gamepad2Icon,
  HeadphonesIcon,
  LaptopIcon,
  ShirtIcon,
  SmartphoneIcon,
  WatchIcon,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuGroup,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import StatusBadge from "@/components/ui/status-badge";

// Inferable type for Item
export type Item = {
  id: string;
  productImage: string;
  product: string;
  brand: string;
  category:
    | "controller"
    | "fashion"
    | "furniture"
    | "headphone"
    | "laptop"
    | "smartphone"
    | "smartwatch";
  stock: "available" | "unavailable";
  amount: number;
  quantity: number;
  status: "inactive" | "publish" | "scheduled";
};
export const customColumns: ColumnDef<Item>[] = [
  {
    id: "select",
    header: ({ table }) => (
      <Checkbox
        checked={
          table.getIsAllPageRowsSelected() ||
          (table.getIsSomePageRowsSelected() && "indeterminate")
        }
        onCheckedChange={(value) => table.toggleAllRowsSelected(!!value)}
        aria-label="Select all"
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(value) => row.toggleSelected(!!value)}
        aria-label="Select row"
      />
    ),
    size: 50,
  },
  {
    header: "Product",
    accessorKey: "product",
    cell: ({ row }) => (
      <div className="flex items-center gap-2">
        <div className="bg-primary/5 flex size-10 items-center justify-center rounded-sm">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={row.original.productImage}
            alt={row.getValue("product")}
            className="w-7.5"
          />
        </div>
        <div className="flex flex-col">
          <span className="font-medium">{row.getValue("product")}</span>
          <span className="text-muted-foreground">{row.original.brand}</span>
        </div>
      </div>
    ),
    size: 246,
  },
  {
    header: "Category",
    accessorKey: "category",
    cell: ({ row }) => {
      const category = row.getValue("category") as string;

      const icon = {
        controller: <Gamepad2Icon className="size-4.5" />,
        fashion: <ShirtIcon className="size-4.5" />,
        furniture: <ArmchairIcon className="size-4.5" />,
        headphone: <HeadphonesIcon className="size-4.5" />,
        laptop: <LaptopIcon className="size-4.5" />,
        smartphone: <SmartphoneIcon className="size-4.5" />,
        smartwatch: <WatchIcon className="size-4.5" />,
      }[category];

      return (
        <div className="flex items-center gap-2">
          <Avatar className="size-7">
            <AvatarFallback className="bg-primary/10 text-primary">
              {icon}
            </AvatarFallback>
          </Avatar>
          <span className="text-muted-foreground capitalize">{category}</span>
        </div>
      );
    },
    size: 180,
    meta: {
      filterVariant: "select",
    },
  },
  {
    header: "Stock",
    accessorKey: "stock",
    cell: ({ row }) => (
      <Switch
        aria-label="Medium switch"
        defaultChecked={row.getValue("stock") === "available"}
        className="h-5.5 w-10 [&_span]:size-5 data-[state=checked]:[&_span]:translate-x-4.5 data-[state=checked]:[&_span]:rtl:-translate-x-4.5"
        disabled
      />
    ),
    size: 110,
    meta: {
      filterVariant: "select",
    },
  },
  {
    header: "Amount",
    accessorKey: "amount",
    cell: ({ row }) => {
      const amount = parseFloat(row.getValue("amount") as string);

      const formatted = new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }).format(amount);

      return <span>{formatted.slice(0, -3)}</span>;
    },
  },
  {
    header: "QTY",
    accessorKey: "quantity",
    cell: ({ row }) => <span>{row.getValue("quantity")}</span>,
  },
  {
    header: "Status",
    accessorKey: "status",
    cell: ({ row }) => {
      const status = row.getValue("status") as string;

      return <StatusBadge status={status} />;
    },
    meta: {
      filterVariant: "select",
    },
  },
  {
    id: "actions",
    header: () => "Actions",
    cell: ({ row }) => (
      <div>
        <RowActions />
      </div>
    ),
    size: 60,
    enableHiding: false,
  },
];

function RowActions() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <div className="flex">
          <Button
            size="icon"
            variant="ghost"
            className="rounded-full p-2"
            aria-label="Edit item"
          >
            <EllipsisVerticalIcon className="size-4.5" aria-hidden="true" />
          </Button>
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuGroup>
          <DropdownMenuItem>
            <span>Edit</span>
          </DropdownMenuItem>
          <DropdownMenuItem>
            <span>Duplicate</span>
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive">
            <span>Delete</span>
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default customColumns;
