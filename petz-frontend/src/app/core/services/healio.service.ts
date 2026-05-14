import { Injectable } from '@angular/core';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { environment } from '../../../environments/environment';
import { firstValueFrom } from 'rxjs';
import { catchError, of } from 'rxjs';
import { GoogleGenerativeAI, ChatSession } from '@google/generative-ai';

@Injectable({ providedIn: 'root' })
export class HealioService {

  private chat: ChatSession | null = null;

  constructor(private api: ApiService, private auth: AuthService) {}

  // ─────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────

  async initSession(): Promise<void> {
    if (this.chat) return;

    const ctx          = await this.fetchAllContext();
    const systemPrompt = this.buildSystemPrompt(ctx);
    const genAI        = new GoogleGenerativeAI(environment.geminiKey);
    const model        = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: systemPrompt,
    });

    this.chat = model.startChat({ history: [] });
  }

  async sendMessage(userText: string): Promise<string> {
    if (!this.chat) await this.initSession();
    const result = await this.chat!.sendMessage(userText);
    return result.response.text();
  }

  resetSession(): void {
    this.chat = null;
  }

  // ─────────────────────────────────────────────────────────────
  // Context fetching — platform data + user-specific data
  // ─────────────────────────────────────────────────────────────

  private async fetchAllContext(): Promise<any> {
    const user = this.auth.currentUser$.value;
    const role = user?.role ?? 'USER';
    const ctx: any = { user, role };

    // ── 1. Platform-level data (fetched for ALL roles) ────────
    // Every user can ask "find me a hospital" or "show animals for adoption"
    try {
      const [hospitals, animals] = await Promise.all([
        firstValueFrom(this.api.get<any>('/hospitals/public').pipe(catchError(() => of({ data: [] })))),
        firstValueFrom(this.api.get<any>('/adoption/animals').pipe(catchError(() => of({ data: [] })))),
      ]);
      ctx.allHospitals = hospitals.data ?? [];
      ctx.allAnimals   = animals.data   ?? [];
    } catch {
      ctx.allHospitals = [];
      ctx.allAnimals   = [];
    }

    // ── 2. User-specific data (role-aware) ────────────────────
    try {
      if (role === 'USER') {
        const [pets, appts, rescues, adoptions] = await Promise.all([
          firstValueFrom(this.api.get<any>('/pets/my').pipe(catchError(() => of({ data: [] })))),
          firstValueFrom(this.api.get<any>('/appointments/my').pipe(catchError(() => of({ data: [] })))),
          firstValueFrom(this.api.get<any>('/rescue/my').pipe(catchError(() => of({ data: [] })))),
          firstValueFrom(this.api.get<any>('/adoption/my-applications').pipe(catchError(() => of({ data: [] })))),
        ]);
        ctx.pets         = pets.data      ?? [];
        ctx.appointments = appts.data     ?? [];
        ctx.rescues      = rescues.data   ?? [];
        ctx.adoptions    = adoptions.data ?? [];

      } else if (role === 'NGO') {
        const [profile, animals, applications] = await Promise.all([
          firstValueFrom(this.api.get<any>('/ngo/profile').pipe(catchError(() => of({ data: null })))),
          firstValueFrom(this.api.get<any>('/adoption/ngo/animals').pipe(catchError(() => of({ data: [] })))),
          firstValueFrom(this.api.get<any>('/adoption/ngo/applications').pipe(catchError(() => of({ data: [] })))),
        ]);
        ctx.ngoProfile      = profile.data;
        ctx.ngoAnimals      = animals.data      ?? [];
        ctx.ngoApplications = applications.data ?? [];

      } else if (role === 'HOSPITAL') {
        const [profile, appts] = await Promise.all([
          firstValueFrom(this.api.get<any>('/hospitals/profile').pipe(catchError(() => of({ data: null })))),
          firstValueFrom(this.api.get<any>('/appointments/hospital').pipe(catchError(() => of({ data: [] })))),
        ]);
        ctx.hospitalProfile = profile.data;
        ctx.hospitalAppts   = appts.data ?? [];
      }
    } catch {
      // partial context is fine
    }

    return ctx;
  }

  // ─────────────────────────────────────────────────────────────
  // System-prompt builder
  // ─────────────────────────────────────────────────────────────

  private buildSystemPrompt(ctx: any): string {
    const { user, role } = ctx;
    const name  = user?.name ?? 'there';
    const today = new Date().toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });

    let p = `
You are Healio, the friendly AI assistant for the PETZ Animal Welfare Platform.
Today is ${today}.
You are talking to ${name} (role: ${role}).

## Persona
- Expert veterinarian with 15+ years of clinical experience
- Warm, empathetic and genuinely passionate about animals
- Give clear, practical advice in simple, non-jargon language
- For any urgent medical situation always recommend an in-person vet visit as well

## IMPORTANT — Answer from real data first
The sections below contain REAL live data from the PETZ platform.
- When a user asks "find me a hospital", "show hospitals", "which vets are available" etc. → LIST the hospitals from the data below. Do NOT tell them where to click.
- When a user asks "show animals for adoption", "find dogs for adoption" etc. → LIST the animals from the data below.
- When a user asks about their own pets, appointments, rescues → answer from their personal data below.
- Only give navigation steps if no relevant data is available or if the user explicitly asks how to do something.

`;

    // ── PLATFORM DATA (always included) ──────────────────────────
    const hospitals: any[] = ctx.allHospitals ?? [];
    const allAnimals: any[] = ctx.allAnimals ?? [];

    p += `## Hospitals on PETZ (${hospitals.length} registered)\n`;
    if (hospitals.length === 0) {
      p += 'No hospitals registered yet.\n';
    } else {
      hospitals.forEach((h: any) => {
        p += `- **${h.name}**`;
        if (h.city)    p += ` | City: ${h.city}`;
        if (h.address) p += ` | Address: ${h.address}`;
        if (h.phone)   p += ` | Phone: ${h.phone}`;
        if (h.email)   p += ` | Email: ${h.email}`;
        p += '\n';
        // List doctors if available
        if (h.doctors && h.doctors.length > 0) {
          h.doctors.forEach((d: any) => {
            p += `  • Dr. ${d.name}${d.specialization ? ' — ' + d.specialization : ''}\n`;
          });
        }
      });
    }

    p += `\n## Animals Available for Adoption on PETZ (${allAnimals.filter((a: any) => a.status === 'AVAILABLE').length} available)\n`;
    if (allAnimals.length === 0) {
      p += 'No animals listed yet.\n';
    } else {
      allAnimals.filter((a: any) => a.status === 'AVAILABLE').forEach((a: any) => {
        p += `- **${a.name}** (${a.species ?? '?'}${a.breed ? ', ' + a.breed : ''})`;
        if (a.city)        p += ` | City: ${a.city}`;
        if (a.ageMonths != null) p += ` | Age: ${this.fmtAge(a.ageMonths)}`;
        if (a.gender)      p += ` | ${a.gender}`;
        if (a.isVaccinated) p += ` | Vaccinated ✓`;
        p += '\n';
      });
    }

    // ── USER-SPECIFIC DATA ────────────────────────────────────────
    p += `\n## ${name}'s Personal Data\n`;

    if (role === 'USER') {
      const pets      = ctx.pets        ?? [];
      const appts     = ctx.appointments ?? [];
      const rescues   = ctx.rescues      ?? [];
      const adoptions = ctx.adoptions    ?? [];

      p += `\n### My Pets (${pets.length})\n`;
      if (pets.length === 0) {
        p += 'No pets registered yet.\n';
      } else {
        pets.forEach((pet: any) => {
          p += `- ${pet.name} — ${pet.species ?? '?'}, ${pet.breed ?? 'mixed'}, `
             + `${pet.ageYears ?? '?'} yr, ${pet.gender ?? '?'}, ${pet.weightKg ?? '?'} kg`
             + (pet.notes ? ` | Notes: ${pet.notes}` : '') + '\n';
        });
      }

      const upcoming = appts.filter((a: any) => ['PENDING', 'CONFIRMED'].includes(a.status ?? ''));
      p += `\n### My Appointments (${appts.length} total, ${upcoming.length} upcoming)\n`;
      if (upcoming.length > 0) {
        upcoming.slice(0, 5).forEach((a: any) => {
          p += `- ${a.apptDate} ${a.apptTime} at ${a.hospitalName ?? 'Hospital'}`
             + ` with Dr. ${a.doctorName ?? 'Doctor'} — ${a.status}`
             + (a.reason ? ` (${a.reason})` : '') + '\n';
        });
      } else {
        p += 'No upcoming appointments.\n';
      }

      p += `\n### My Rescue Reports (${rescues.length})\n`;
      rescues.slice(0, 5).forEach((r: any) => {
        p += `- ${r.animalType ?? 'Animal'} at ${r.address ?? 'unknown location'}`
           + ` — ${r.status} (${r.criticality ?? 'unknown criticality'})\n`;
      });
      if (rescues.length === 0) p += 'No rescue reports yet.\n';

      p += `\n### My Adoption Applications (${adoptions.length})\n`;
      adoptions.forEach((a: any) => {
        p += `- Applied for ${a.animalName ?? 'animal'} — Status: ${a.status}\n`;
      });
      if (adoptions.length === 0) p += 'No adoption applications yet.\n';

    } else if (role === 'NGO') {
      const ngo   = ctx.ngoProfile;
      const animals = ctx.ngoAnimals      ?? [];
      const apps    = ctx.ngoApplications ?? [];

      if (ngo) {
        p += `\n### My NGO Profile\n- Name: ${ngo.name}\n- City: ${ngo.city ?? 'N/A'}`
           + `\n- Verified: ${ngo.isVerified ? 'Yes ✓' : 'Not yet'}\n`;
      }
      p += `\n### Animals I've Listed (${animals.length})\n`;
      animals.slice(0, 8).forEach((a: any) => {
        p += `- ${a.name} (${a.species ?? '?'}) — ${a.status ?? 'AVAILABLE'}\n`;
      });
      const pending = apps.filter((a: any) => a.status === 'PENDING').length;
      p += `\n### Adoption Applications (${apps.length} total, ${pending} pending review)\n`;

    } else if (role === 'HOSPITAL') {
      const hosp  = ctx.hospitalProfile;
      const appts = ctx.hospitalAppts ?? [];

      if (hosp) {
        p += `\n### My Hospital Profile\n- Name: ${hosp.name}\n- City: ${hosp.city ?? 'N/A'}\n`;
      }
      const todayStr   = new Date().toISOString().split('T')[0];
      const todayAppts = appts.filter((a: any) => a.apptDate === todayStr).length;
      const pending    = appts.filter((a: any) => a.status === 'PENDING').length;
      p += `\n### Appointments\n- Total: ${appts.length}\n- Today: ${todayAppts}`
         + `\n- Pending confirmation: ${pending}\n`;

    } else if (role === 'ADMIN') {
      p += '\nYou are the platform administrator.\n';
    }

    p += `
## Response Style
- Keep answers concise and friendly
- When listing hospitals or animals, format as a clean bullet list with name, location, phone
- Use 1–2 emojis per response, never more
- Never invent data — only reference what is in this prompt
- For medical emergencies, add: "Please visit a vet promptly for proper examination"

## When to show navigation steps vs real data
- User asks "find / show / list / which hospitals" → LIST hospitals from the data above
- User asks "find / show animals for adoption" → LIST animals from the data above
- User asks "how do I book" / "how do I report" → THEN give navigation steps
- User asks about their own data → answer from personal data section above

## When a topic relates to PETZ, add an "On PETZ:" action tip
- Pet injury / vet needed → "**On PETZ:** Book an appointment at [hospital name from the list above]"
- Stray animal found → "**On PETZ:** Report this rescue — go to **Rescue → Report Rescue**"
- Wants to adopt → "**On PETZ:** Apply for [animal name] — go to **Browse Animals**"
- Pet care / profile → "**On PETZ:** Update your pet's profile under **Dashboard → My Pets**"
Only add the tip when it genuinely fits.
`;

    return p;
  }

  private fmtAge(months: number): string {
    if (months < 12) return `${months} mo`;
    const y = Math.floor(months / 12), m = months % 12;
    return m > 0 ? `${y} yr ${m} mo` : `${y} yr`;
  }
}
