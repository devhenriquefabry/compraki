import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { 
  IonContent, IonHeader, IonTitle, IonToolbar, 
  IonButtons, IonBackButton, IonSpinner, IonIcon 
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { heartOutline } from 'ionicons/icons';
import { Subscription } from 'rxjs';
import { SavedItem } from '../../interfaces/saved-item';
import { FirebaseSavedService } from '../../services/firebase-saved.service';
import { SavedProductCardComponent } from '../../components/saved-product-card/saved-product-card.component';
import { SavedFilterComponent } from '../../components/saved-filter/saved-filter.component';
import { SavedUndoToastComponent } from '../../components/saved-undo-toast/saved-undo-toast.component';

@Component({
  selector: 'app-saved-page',
  templateUrl: './saved.page.html',
  styleUrls: ['./saved.page.scss'],
  standalone: true,
  imports: [
    CommonModule, 
    IonContent, IonHeader, IonTitle, IonToolbar, 
    IonButtons, IonBackButton, IonSpinner, IonIcon,
    SavedProductCardComponent, SavedFilterComponent, SavedUndoToastComponent
  ]
})
export class SavedPage implements OnInit, OnDestroy {
  savedItems: SavedItem[] = [];
  filteredItems: SavedItem[] = [];
  isLoading = true;
  activeFilter = 'Todos';
  
  showUndoToast = false;
  lastRemovedItem: SavedItem | null = null;
  undoTimeout: any;

  private sub!: Subscription;

  constructor(private savedService: FirebaseSavedService) {
    addIcons({ heartOutline });
  }

  ngOnInit() {
    this.sub = this.savedService.getAllSaved().subscribe({
      next: (items) => {
        this.savedItems = items;
        this.applyFilter(this.activeFilter);
        this.isLoading = false;
      },
      error: (err) => {
        console.error('Error fetching favorites', err);
        this.isLoading = false;
      }
    });
  }

  ngOnDestroy() {
    if (this.sub) this.sub.unsubscribe();
    if (this.undoTimeout) clearTimeout(this.undoTimeout);
  }

  onFilterChanged(filter: string) {
    this.activeFilter = filter;
    this.applyFilter(filter);
  }

  applyFilter(filter: string) {
    if (filter === 'Todos') {
      this.filteredItems = [...this.savedItems];
    } else if (filter === 'Novos') {
      this.filteredItems = this.savedItems.filter(i => i.productData.condition === 'novo');
    } else if (filter === 'Usados') {
      this.filteredItems = this.savedItems.filter(i => i.productData.condition?.startsWith('usado'));
    }
  }

  async onRemove(item: SavedItem) {
    if (!item.id) return;
    
    // Optimistic UI update
    const prevItems = [...this.savedItems];
    this.savedItems = this.savedItems.filter(i => i.id !== item.id);
    this.applyFilter(this.activeFilter);
    
    this.lastRemovedItem = item;
    this.showUndoToast = true;
    
    // Clear previous timeout
    if (this.undoTimeout) clearTimeout(this.undoTimeout);
    
    // Execute removal in backend after 4 seconds if not undone
    this.undoTimeout = setTimeout(async () => {
      this.showUndoToast = false;
      try {
        await this.savedService.removeProduct(item.id!);
        this.lastRemovedItem = null;
      } catch (e) {
        console.error('Fail to remove:', e);
        // Revert UI on fail
        this.savedItems = prevItems;
        this.applyFilter(this.activeFilter);
      }
    }, 4000);
  }

  onUndo() {
    if (this.undoTimeout) clearTimeout(this.undoTimeout);
    this.showUndoToast = false;
    
    if (this.lastRemovedItem) {
      // It was never removed from backend, just put it back in UI
      this.savedItems = [...this.savedItems, this.lastRemovedItem].sort((a,b) => {
           if(!a.savedAt || !b.savedAt) return 0;
           return b.savedAt.seconds - a.savedAt.seconds;
      });
      this.applyFilter(this.activeFilter);
      this.lastRemovedItem = null;
    }
  }
}
