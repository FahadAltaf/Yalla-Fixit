// app/api/fsm/test/route.ts
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  ZOHO FSM — BULK DOWNLOAD (Single Call, Full Verification)
//
//  GET /api/fsm/test?name=WO731
//
//  Flow:
//    1. Search Work Orders by name        → /Work_Orders/search?api_name=Name&value=WO731
//    2. Get Work Order detail by id       → /Work_Orders/{id}
//       └─ Extract Service_Appointment ids from Appointments_X_Services[]
//    3. Get attachments for each appt id  → /Service_Appointments/{id}/attachments
//
//  No separate appointments API call needed —
//  Work Order detail already contains Service_Appointment { name, id } in Appointments_X_Services!
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { NextRequest, NextResponse } from "next/server";
import { createServerClientForApi } from "@/lib/supabase/supabase-server-client";

const BASE_URL = "https://fsm.zoho.com/fsm/v1";

// ─── TYPES ────────────────────────────────────────────────────────────────────

interface ZohoAttachment {
  id: string;
  File_Name?: string;
  file_name?: string;
  Name?:      string;
  name?:      string;
  [key: string]: unknown;
}

// Each item inside Appointments_X_Services[]
interface AppointmentXService {
  id: string;
  Name?: string;
  Service_Appointment?: {
    name: string; // e.g. "AP-856"
    id:   string; // the appointment id we need
  };
  SLI_Status?: string;
  STLI_Status?: string;
  [key: string]: unknown;
}

interface ZohoWorkOrder {
  id:   string;
  Name?: string;
  Status?: string;
  Summary?: string;
  Created_Time?: string;
  Service_Appointments?: unknown[];           // always [] per Zoho — ignore this
  Appointments_X_Services?: AppointmentXService[]; // ✅ this has the real appt ids
  [key: string]: unknown;
}

interface AppointmentResult {
  appointment_name: string;
  appointment_id:   string;
  attachments: {
    api_url:  string;
    total:    number;
    files:    ZohoAttachment[];
    error?:   string;
  };
}

interface WorkOrderResult {
  work_order_id:   string;
  work_order_name: string | undefined;
  step1_search_data:      ZohoWorkOrder;       // raw from search
  step2_detail_data:      ZohoWorkOrder[]; // raw from detail
  appointments_extracted: {                    // parsed from Appointments_X_Services
    total:        number;
    appointments: AppointmentResult[];
  };
  error?: string;
}

// ─── TOKEN ────────────────────────────────────────────────────────────────────

async function getAccessToken(): Promise<string> {
  const supabase = await createServerClientForApi();
  const { data: settings, error } = await supabase
    .from("settings")
    .select("oauth_access_token")
    .eq("id", 1)
    .single();

  if (error || !settings?.oauth_access_token) {
    throw new Error(`Failed to fetch access token: ${error?.message ?? "token is empty"}`);
  }
  return settings.oauth_access_token as string;
}

// ─── BASE FETCH ───────────────────────────────────────────────────────────────

async function zFetch(url: string): Promise<Response> {
  const token = await getAccessToken();
  const res = await fetch(url, {
    headers: {
      Authorization:  `Zoho-oauthtoken ${token}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Zoho API [${res.status}]: ${text}`);
  }
  return res;
}

// ─── API FUNCTIONS ────────────────────────────────────────────────────────────

// STEP 1 — Search Work Orders by name
async function searchWorkOrders(name: string, comparator: string): Promise<ZohoWorkOrder[]> {
  const res  = await zFetch(`${BASE_URL}/Work_Orders/search?api_name=Name&value=${encodeURIComponent(name)}&comparator=${comparator}`);
  const json = await res.json();
  return json?.data ?? [];
}

// STEP 2 — Get Work Order full detail (contains Appointments_X_Services with appt ids)
async function getWorkOrderDetail(woId: string): Promise<ZohoWorkOrder[]> {
  const res  = await zFetch(`${BASE_URL}/Work_Orders/${woId}`);
  const json = await res.json();
  return json?.data ?? [];
}

// STEP 3 — Get attachments for a single appointment
async function getAppointmentAttachments(apptId: string): Promise<ZohoAttachment[]> {
  try {
    const res  = await zFetch(`${BASE_URL}/Service_Appointments/${apptId}/Attachments`);
    const json = await res.json();
    return json?.data ?? [];
  } catch {
    return [];
  }
}

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const name       = searchParams.get("name");
  const comparator = searchParams.get("comparator") ?? "contains";

  if (!name) {
    return NextResponse.json({
      message: "Zoho FSM — Bulk Download Verification Route",
      usage:   "GET /api/fsm/test?name=WO731",
      params:  { comparator: "contains (default) | equal" },
      flow: [
        "1. Search Work Orders by name",
        "2. Get Work Order detail → extract Service_Appointment ids from Appointments_X_Services[]",
        "3. Get attachments for each appointment id",
      ],
    });
  }

  try {

    // ── STEP 1: Search Work Orders by name ───────────────────────────────────
    const step1_url     = `${BASE_URL}/Work_Orders/search?api_name=Name&value=${encodeURIComponent(name)}&comparator=${comparator}`;
    const searchResults = await searchWorkOrders(name, comparator);

    if (searchResults.length === 0) {
      return NextResponse.json({
        success: false,
        step1_search: { api_url: step1_url, total_found: 0, work_orders: [] },
        message: "No work orders found. Try comparator=contains or check the name.",
      });
    }

    // ── STEP 2 + 3: For each found Work Order ─────────────────────────────────
    const workOrderResults: WorkOrderResult[] = await Promise.all(
      searchResults.map(async (wo): Promise<WorkOrderResult> => {
        try {

          // STEP 2: Get full Work Order detail
          const woDetail = await getWorkOrderDetail(wo.id);
          console.log("🚀 ~ GET ~ woDetail:", woDetail)

          // Extract unique appointment ids from Appointments_X_Services
          const axsItems: AppointmentXService[] = woDetail?.[0]?.Appointments_X_Services ?? [];
          console.log("🚀 ~ GET ~ axsItems:", axsItems)

          // Deduplicate — multiple services can share same appointment
          const uniqueAppointments = new Map<string, string>(); // id → name
          for (const item of axsItems) {
            if (item.Service_Appointment?.id) {
              uniqueAppointments.set(
                item.Service_Appointment.id,
                item.Service_Appointment.name
              );
            }
          }
          console.log("🚀 ~ GET ~ uniqueAppointments:", uniqueAppointments)

          // STEP 3: Get attachments for each unique appointment
          const appointmentResults: AppointmentResult[] = await Promise.all(
            Array.from(uniqueAppointments.entries()).map(
              async ([apptId, apptName]): Promise<AppointmentResult> => {
                try {
                  const attachments = await getAppointmentAttachments(apptId);
                  return {
                    appointment_name: apptName,
                    appointment_id:   apptId,
                    attachments: {
                      api_url: `${BASE_URL}/Service_Appointments/${apptId}/attachments`,
                      total:   attachments.length,
                      files:   attachments,
                    },
                  };
                } catch (err: unknown) {
                  return {
                    appointment_name: apptName,
                    appointment_id:   apptId,
                    attachments: {
                      api_url: `${BASE_URL}/Service_Appointments/${apptId}/attachments`,
                      total:   0,
                      files:   [],
                      error:   err instanceof Error ? err.message : "Unknown error",
                    },
                  };
                }
              }
            )
          );

          return {
            work_order_id:   wo.id,
            work_order_name: wo.Name,
            step1_search_data:      wo,
            step2_detail_data:      woDetail,
            appointments_extracted: {
              total:        uniqueAppointments.size,
              appointments: appointmentResults,
            },
          };

        } catch (err: unknown) {
          return {
            work_order_id:   wo.id,
            work_order_name: wo.Name,
            step1_search_data:      wo,
            step2_detail_data:      [],
            appointments_extracted: { total: 0, appointments: [] },
            error: err instanceof Error ? err.message : "Unknown error",
          };
        }
      })
    );

    // ── Summary ───────────────────────────────────────────────────────────────
    const totalAppointments = workOrderResults.reduce(
      (sum, wo) => sum + wo.appointments_extracted.total, 0
    );
    const totalAttachments = workOrderResults.reduce(
      (sum, wo) => sum + wo.appointments_extracted.appointments.reduce(
        (s, appt) => s + appt.attachments.total, 0
      ), 0
    );

    return NextResponse.json({
      success: true,

      summary: {
        search_query:       name,
        comparator,
        total_work_orders:  searchResults.length,
        total_appointments: totalAppointments,
        total_attachments:  totalAttachments,
      },

      step1_search: {
        api_url:     step1_url,
        total_found: searchResults.length,
      },

      work_orders: workOrderResults,
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Something went wrong";
    console.error("[FSM Test Route] Failed:", error);
    return NextResponse.json(
      {
        success: false,
        error:   message,
        hint:    "Check Supabase settings table — oauth_access_token might be missing or expired",
      },
      { status: 500 }
    );
  }
}