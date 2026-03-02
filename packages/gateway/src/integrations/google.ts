/**
 * Google Integration — Google Calendar, Drive, Gmail stubs.
 * Uses googleapis SDK for authenticated access.
 */
import { google, type calendar_v3 } from "googleapis";
import { createChildLogger } from "../logger/index.js";

const log = createChildLogger("integrations:google");

export interface CalendarEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  location?: string;
  description?: string;
}

/**
 * Google API client for Calendar, Drive, Gmail.
 */
export class GoogleClient {
  private auth;

  constructor(clientId: string, clientSecret: string, refreshToken?: string) {
    this.auth = new google.auth.OAuth2(clientId, clientSecret);
    if (refreshToken) {
      this.auth.setCredentials({ refresh_token: refreshToken });
    }
    log.info("Google client initialized");
  }

  /**
   * List upcoming calendar events.
   */
  async listEvents(maxResults = 10): Promise<CalendarEvent[]> {
    const calendar = google.calendar({ version: "v3", auth: this.auth });
    const { data } = await calendar.events.list({
      calendarId: "primary",
      timeMin: new Date().toISOString(),
      maxResults,
      singleEvents: true,
      orderBy: "startTime",
    });

    return (data.items ?? []).map((e) => ({
      id: e.id ?? "",
      summary: e.summary ?? "(no title)",
      start: e.start?.dateTime ?? e.start?.date ?? "",
      end: e.end?.dateTime ?? e.end?.date ?? "",
      location: e.location ?? undefined,
      description: e.description ?? undefined,
    }));
  }

  /**
   * Create a calendar event.
   */
  async createEvent(
    summary: string,
    start: string,
    end: string,
    description?: string
  ): Promise<CalendarEvent> {
    const calendar = google.calendar({ version: "v3", auth: this.auth });
    const { data } = await calendar.events.insert({
      calendarId: "primary",
      requestBody: {
        summary,
        description,
        start: { dateTime: start },
        end: { dateTime: end },
      },
    });

    log.info({ eventId: data.id }, "Calendar event created");

    return {
      id: data.id ?? "",
      summary: data.summary ?? summary,
      start: data.start?.dateTime ?? start,
      end: data.end?.dateTime ?? end,
      description,
    };
  }

  /**
   * List files from Google Drive.
   */
  async listDriveFiles(query?: string, maxResults = 20) {
    const drive = google.drive({ version: "v3", auth: this.auth });
    const { data } = await drive.files.list({
      pageSize: maxResults,
      q: query,
      fields: "files(id, name, mimeType, modifiedTime, size)",
    });

    return (data.files ?? []).map((f) => ({
      id: f.id ?? "",
      name: f.name ?? "",
      mimeType: f.mimeType ?? "",
      modifiedTime: f.modifiedTime ?? "",
      size: f.size ?? "0",
    }));
  }

  /**
   * Get OAuth2 authorization URL for initial setup.
   */
  getAuthUrl(): string {
    return this.auth.generateAuthUrl({
      access_type: "offline",
      scope: [
        "https://www.googleapis.com/auth/calendar",
        "https://www.googleapis.com/auth/drive.readonly",
        "https://www.googleapis.com/auth/gmail.readonly",
      ],
    });
  }

  /**
   * Exchange authorization code for tokens.
   */
  async exchangeCode(code: string): Promise<string | undefined> {
    const { tokens } = await this.auth.getToken(code);
    this.auth.setCredentials(tokens);
    return tokens.refresh_token ?? undefined;
  }
}
