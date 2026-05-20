import { Component, OnInit } from '@angular/core';
import { ApiService } from '../../../core/services/api.service';
import { AdoptableAnimal } from '../../../core/models/adoption.model';
import { MatSnackBar } from '@angular/material/snack-bar';
import { environment } from '../../../../environments/environment';

@Component({
  standalone: false,
  selector: 'app-ngo-animals',
  templateUrl: './ngo-animals.component.html',
  styleUrls: ['./ngo-animals.component.scss']
})
export class NgoAnimalsComponent implements OnInit {
  animals: AdoptableAnimal[] = [];
  filtered: AdoptableAnimal[] = [];
  selected: AdoptableAnimal | null = null;
  showForm  = false;
  editMode  = false;          // true = editing existing, false = adding new
  editingId: number | null = null;
  saving    = false;
  newAnimal: any = {};

  // Photo upload state
  photoFile:    File | null   = null;
  photoPreview: string | null = null;

  filter = { search: '', species: '', status: '', sort: 'newest' };

  readonly cities: string[] = [
    'Ahmedabad', 'Bengaluru', 'Bhopal', 'Chennai', 'Coimbatore',
    'Delhi', 'Hyderabad', 'Indore', 'Jaipur', 'Kochi',
    'Kolkata', 'Lucknow', 'Mumbai', 'Nagpur', 'Patna',
    'Pune', 'Surat', 'Thiruvananthapuram', 'Vadodara', 'Visakhapatnam',
  ];

  get availableCount()  { return this.animals.filter(a => a.status === 'AVAILABLE').length; }
  get adoptedCount()    { return this.animals.filter(a => a.status === 'ADOPTED').length; }
  get vaccinatedCount() { return this.animals.filter(a => a.isVaccinated).length; }
  get uniqueCities()    { return new Set(this.animals.map(a => a.city).filter(Boolean)).size; }
  get speciesList(): string[] {
    return [...new Set(this.animals.map(a => a.species).filter(Boolean) as string[])].sort();
  }
  get hasActiveFilters(): boolean {
    return !!(this.filter.search || this.filter.species || this.filter.status);
  }

  imgSrc(url?: string): string {
    if (!url) return '';
    return url.startsWith('http') ? url : environment.mediaUrl + url;
  }

  fmtAge(months?: number): string {
    if (!months && months !== 0) return '—';
    if (months < 12) return `${months} mo`;
    const y = Math.floor(months / 12), m = months % 12;
    return m > 0 ? `${y} yr ${m} mo` : `${y} yr`;
  }

  fmtDate(iso: string): string {
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  statusClass(status: string): string {
    switch (status?.toUpperCase()) {
      case 'AVAILABLE': return 'chip-avail';
      case 'ADOPTED':   return 'chip-adopted';
      case 'PENDING':   return 'chip-pending';
      default:          return 'chip-default';
    }
  }

  applyFilters(): void {
    let r = [...this.animals];
    const q = this.filter.search.toLowerCase().trim();
    if (q) r = r.filter(a => a.name.toLowerCase().includes(q) || a.breed?.toLowerCase().includes(q));
    if (this.filter.species) r = r.filter(a => a.species === this.filter.species);
    if (this.filter.status)  r = r.filter(a => a.status?.toUpperCase() === this.filter.status);
    if (this.filter.sort === 'newest') r.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
    if (this.filter.sort === 'oldest') r.sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());
    if (this.filter.sort === 'az')     r.sort((a, b) => a.name.localeCompare(b.name));
    if (this.filter.sort === 'za')     r.sort((a, b) => b.name.localeCompare(a.name));
    this.filtered = r;
  }

  clearFilters(): void {
    this.filter = { search: '', species: '', status: '', sort: 'newest' };
    this.applyFilters();
  }

  constructor(private api: ApiService, private snack: MatSnackBar) {}

  ngOnInit(): void {
    this.api.get<any>('/adoption/ngo/animals').subscribe({
      next: res => { this.animals = res.data ?? []; this.applyFilters(); },
      error: ()  => {}
    });
  }

  onPhotoSelected(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.photoFile = file;
    const reader = new FileReader();
    reader.onload = e => { this.photoPreview = e.target?.result as string; };
    reader.readAsDataURL(file);
  }

  cancelForm(): void {
    this.showForm     = false;
    this.editMode     = false;
    this.editingId    = null;
    this.newAnimal    = {};
    this.photoFile    = null;
    this.photoPreview = null;
  }

  openEdit(animal: AdoptableAnimal): void {
    this.newAnimal = {
      name:         animal.name,
      species:      animal.species      ?? '',
      breed:        animal.breed        ?? '',
      city:         animal.city         ?? '',
      ageMonths:    animal.ageMonths,
      gender:       animal.gender       ?? '',
      description:  animal.description  ?? '',
      isVaccinated: animal.isVaccinated ?? false,
      isNeutered:   animal.isNeutered   ?? false,
      status:       animal.status,
    };
    this.photoPreview = animal.photoUrl ? this.imgSrc(animal.photoUrl) : null;
    this.photoFile    = null;
    this.editingId    = animal.id;
    this.editMode     = true;
    this.showForm     = true;
    this.selected     = null;   // close detail popup
  }

  addAnimal(): void {
    if (!this.newAnimal.name || this.saving) return;
    this.saving = true;

    this.api.post<any>('/adoption/ngo/animals', this.newAnimal).subscribe({
      next: res => {
        const saved: AdoptableAnimal = res.data;
        this._uploadPhotoThenFinish(saved, () => {
          this.animals.push(saved);
          this.applyFilters();
          this.saving = false;
          this.cancelForm();
          this.snack.open('Animal added successfully!', '', { duration: 2500 });
        });
      },
      error: err => {
        this.saving = false;
        this.snack.open(err.error?.message ?? 'Error adding animal.', 'Close', { duration: 3000 });
      }
    });
  }

  updateAnimal(): void {
    if (!this.newAnimal.name || this.saving || !this.editingId) return;
    this.saving = true;

    this.api.put<any>(`/adoption/ngo/animals/${this.editingId}`, this.newAnimal).subscribe({
      next: res => {
        const updated: AdoptableAnimal = res.data;
        this._uploadPhotoThenFinish(updated, () => {
          const idx = this.animals.findIndex(a => a.id === updated.id);
          if (idx !== -1) this.animals[idx] = updated;
          this.applyFilters();
          this.saving = false;
          this.cancelForm();
          this.snack.open('Animal updated successfully!', '', { duration: 2500 });
        });
      },
      error: err => {
        this.saving = false;
        this.snack.open(err.error?.message ?? 'Error updating animal.', 'Close', { duration: 3000 });
      }
    });
  }

  private _uploadPhotoThenFinish(animal: AdoptableAnimal, finalize: () => void): void {
    if (this.photoFile) {
      const form = new FormData();
      form.append('file', this.photoFile);
      this.api.postFormData<any>(`/adoption/ngo/animals/${animal.id}/photo`, form).subscribe({
        next: photoRes => {
          if (photoRes?.data?.photoUrl) animal.photoUrl = photoRes.data.photoUrl;
          finalize();
        },
        error: () => {
          this.snack.open('Saved, but photo upload failed.', 'OK', { duration: 3500 });
          finalize();
        }
      });
    } else {
      finalize();
    }
  }

  deleteAnimal(id: number): void {
    if (!confirm('Remove this animal from the adoption list?')) return;
    this.api.delete<any>(`/adoption/ngo/animals/${id}`).subscribe({
      next: () => {
        this.animals = this.animals.filter(a => a.id !== id);
        this.applyFilters();
        this.selected = null;
        this.snack.open('Animal removed.', '', { duration: 2000 });
      },
      error: err => this.snack.open(err.error?.message ?? 'Error removing animal.', 'Close', { duration: 3000 })
    });
  }
}
