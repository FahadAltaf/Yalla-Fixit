import { redirect } from "next/navigation";

/*
  Settings is a group of pages now (Profile, Appearance, AMC Settings), each
  with its own address. /settings opens the first.
*/
export default function SettingsIndex() {
  redirect("/settings/profile");
}
