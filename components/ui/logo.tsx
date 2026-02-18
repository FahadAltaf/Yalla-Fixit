// import Image from "next/image";
// import { cn } from "@/lib/utils";
// import { Settings } from "@/types/types";
// import { useEffect, useState } from "react";

// export default function Logo({ settings }: { settings: Settings }) {
//   const [image, setImage] = useState("");
//   useEffect(() => {
//     setImage(
//       settings?.logo_setting === "horizontal"
//         ? settings?.logo_horizontal_url || ""
//         : settings?.logo_url || ""
//     );
//   }, [settings]);

//   if (!image) return null;
//   return (
//     <Image
//       onClick={() => (window.location.href = "/")}
//       src={image}
//       alt="logo"
//       width={50}
//       height={50}
//       unoptimized
//       className={cn(
//         `w-[${settings?.logo_setting === "horizontal" ? "60%" : "100px"}] h-full cursor-pointer hover:scale-102 object-cover rounded-md transition-opacity duration-300`,
//         "opacity-100"
//       )}
//       style={{
//         width: settings?.logo_setting === "horizontal" ? "60%" : "100px",
//       }}
//       priority
//     />
//   );
// }

// SVG Imports
import LogoSvg from "@/assets/svg/logo";

// Util Imports
import { cn } from "@/lib/utils";

const Logo = ({ className }: { className?: string }) => {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <LogoSvg className="size-8.5" />
      <span className="text-xl font-semibold">YALLA FIXIT</span>
    </div>
  );
};

export default Logo;
