"use client";

import React, { useId } from "react";
import { Label } from "@/components/ui/label";
import { CheckIcon, MinusIcon } from "lucide-react";
import { type Theme, useTheme } from "@/context/ThemeContext";
import Image from "next/image";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { type Settings, settingsService } from "@/modules/settings";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAuth } from "@/context/AuthContext";

export function AppearanceSettings({ settings }: { settings?: Settings }) {
  // Move all hooks to the top of the component
  const { setTheme, setPrimaryColor } = useTheme();
  const id = useId();
  const [loading, setLoading] = React.useState(false);

  // Define color options with proper color values using inline styles
  const colorOptions = [
    {
      name: "Ocean Blue",
      style: { backgroundColor: "#3B82F6", borderColor: "#3B82F6" },
      value: "#3B82F6",
    },
    {
      name: "Royal Purple",
      style: { backgroundColor: "#8B5CF6", borderColor: "#8B5CF6" },
      value: "#8B5CF6",
    },
    {
      name: "Forest Green",
      style: { backgroundColor: "#10B981", borderColor: "#10B981" },
      value: "#10B981",
    },
    {
      name: "Mint Teal",
      style: { backgroundColor: "#14B8A6", borderColor: "#14B8A6" },
      value: "#14B8A6",
    },
    {
      name: "Sunset Orange",
      style: { backgroundColor: "#F97316", borderColor: "#F97316" },
      value: "#F97316",
    },
    {
      name: "Cherry Red",
      style: { backgroundColor: "#EF4444", borderColor: "#EF4444" },
      value: "#EF4444",
    },
    {
      name: "Yalla Red",
      style: { backgroundColor: "#AA272C", borderColor: "#AA272C" },
      value: "#AA272C",
    },
    {
      name: "Deep Indigo",
      style: { backgroundColor: "#6366F1", borderColor: "#6366F1" },
      value: "#6366F1",
    },
    {
      name: "Deep Red",
      style: { backgroundColor: "#83201e", borderColor: "#83201e" },
      value: "#83201e",
    },
  ];

  // Determine default primary color
  const defaultPrimaryColor = settings?.primary_color || colorOptions[0].value;
  const defaultSecondaryColor =
    settings?.secondary_color || colorOptions[0].value;

  const { setSettings } = useAuth();
  // Replace with a properly typed initialization that handles undefined values
  const [settingAppearance, setSettingAppearance] = React.useState<Settings>(
    () => {
      // Create a default settings object with required fields
      const defaultSettings: Settings = {
        id: settings?.id || "",
        appearance_theme: settings?.appearance_theme || "light",
        primary_color: defaultPrimaryColor,
        secondary_color: defaultSecondaryColor,
        site_name: settings?.site_name || "",
        site_description: settings?.site_description || "",
        site_image: settings?.site_image || "",
        logo_url: settings?.logo_url || "",
        favicon_url: settings?.favicon_url || "",
        meta_keywords: settings?.meta_keywords || "",
        meta_description: settings?.meta_description || "",
        contact_email: settings?.contact_email || "",
        social_links: settings?.social_links || "",
        created_at: settings?.created_at || "",
        updated_at: settings?.updated_at || "",
        logo_setting: settings?.logo_setting || "square",
      };

      // If settings is provided, use it as a base but ensure all required fields have values
      return settings ? { ...defaultSettings, ...settings } : defaultSettings;
    }
  );

  // Early return check after all hooks are called
  if (!settings) {
    return null;
  }

  const items = [
    { value: "light", label: "Light", image: "/themes/ui-light.png" },
    { value: "dark", label: "Dark", image: "/themes/ui-dark.png" },
    { value: "system", label: "System", image: "/themes/ui-system.png" },
  ];

  const submitSettings = async () => {
    setLoading(true);
    const payload = {
      appearance_theme: settingAppearance.appearance_theme,
      primary_color: settingAppearance.primary_color,
      secondary_color: settingAppearance.secondary_color,
    };
    const updated_settings = await settingsService.updateSettingsById(
      payload,
      settings?.id
    );
    setSettingAppearance(updated_settings);
    setSettings(updated_settings);
    toast.success("Settings updated successfully");
    setLoading(false);
  };

  const handleThemeChange = (value: Theme) => {
    setTheme(value);
    setSettingAppearance((prev: Settings) => ({
      ...prev,
      appearance_theme: value,
    }));
  };

  const handlePrimaryColorChange = (value: string) => {
    setPrimaryColor(value);
    setSettingAppearance((prev: Settings) => ({
      ...prev,
      primary_color: value,
    }));
  };

  return (
    <Card className="w-full flex-1 relative top-px right-px gap-6">
      {/* <CardHeader>
        <CardTitle className="text-2xl">Appearance Settings</CardTitle>
        <CardDescription>
          Customize the look and feel of your application
        </CardDescription>

     
      </CardHeader> */}
      <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex gap-1 flex-col">
          <CardTitle className=" ">Appearance Settings</CardTitle>
          <CardDescription>
            Customize the look and feel of your application
          </CardDescription>
        </div>
        <Button
          disabled={loading}
          onClick={submitSettings}
          className="w-full sm:w-auto hidden sm:block"
        >
          {loading ? "Saving..." : "Save Changes"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Theme Toggle */}
        <div className="rounded-lg space-y-4">
          <fieldset>
            <RadioGroup
              className="flex gap-3"
              defaultValue={settingAppearance.appearance_theme}
              onValueChange={(value) => handleThemeChange(value as Theme)}
            >
              {items.map((item) => (
                <label
                  key={`${id}-${item.value}`}
                  className="flex flex-col items-center"
                >
                  <RadioGroupItem
                    id={`${id}-${item.value}`}
                    value={item.value}
                    className="peer sr-only after:absolute after:inset-0"
                  />
                  <div className="overflow-hidden rounded-md border border-input peer-data-[state=checked]:border-primary peer-data-[state=checked]:border-2">
                    <Image
                      src={item.image || "/placeholder.svg"}
                      alt={item.label}
                      width={120}
                      height={90}
                      className="object-cover"
                    />
                  </div>
                  <span className="group peer-data-[state=unchecked]:text-muted-foreground/70 mt-2 flex items-center gap-1">
                    <CheckIcon
                      size={16}
                      className="group-peer-data-[state=unchecked]:hidden"
                      aria-hidden="true"
                    />
                    <MinusIcon
                      size={16}
                      className="group-peer-data-[state=checked]:hidden"
                      aria-hidden="true"
                    />
                    <span className="text-xs font-medium">{item.label}</span>
                  </span>
                </label>
              ))}
            </RadioGroup>
          </fieldset>
        </div>

        {/* Primary Color */}
        <div className="space-y-4">
          <div className="space-y-1">
            <Label className="text-base font-medium">Brand Color</Label>
            <p className="text-sm text-muted-foreground">
              Select your brand&apos;s primary color
            </p>
          </div>
          <fieldset>
            <RadioGroup
              className="flex gap-2 flex-wrap"
              defaultValue={defaultPrimaryColor}
              onValueChange={(value) => handlePrimaryColorChange(value)}
            >
              {colorOptions.map((color) => (
                <div key={color.value} className="flex flex-col items-center">
                  <RadioGroupItem
                    value={color.value}
                    aria-label={color.name}
                    style={color.style}
                    className="size-8 shadow-none data-[state=checked]:ring-2 data-[state=checked]:ring-offset-2 data-[state=checked]:ring-offset-background data-[state=checked]:ring-primary"
                  />
                  {/* <span className="text-xs text-muted-foreground mt-1">
                    {color.name}
                  </span> */}
                </div>
              ))}
            </RadioGroup>
          </fieldset>
        </div>
        <Button
          disabled={loading}
          onClick={submitSettings}
          className="w-full sm:w-auto block sm:hidden"
        >
          {loading ? "Saving..." : "Save Changes"}
        </Button>
      </CardContent>
    </Card>
  );
}
