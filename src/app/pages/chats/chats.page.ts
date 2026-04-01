import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { IonContent, IonHeader, IonTitle, IonToolbar, IonList, IonItem, IonAvatar, IonLabel, IonNote, IonSpinner, IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { chatbubblesOutline, personCircle } from 'ionicons/icons';
import { Subscription } from 'rxjs';
import { FirebaseChatService } from '../../services/firebase-chat.service';
import { ChatRoom, ChatParticipant } from '../../interfaces/chat';

@Component({
  selector: 'app-chats',
  templateUrl: './chats.page.html',
  styleUrls: ['./chats.page.scss'],
  standalone: true,
  imports: [CommonModule, IonContent, IonHeader, IonTitle, IonToolbar, IonList, IonItem, IonAvatar, IonLabel, IonNote, IonSpinner, IonIcon]
})
export class ChatsPage implements OnInit, OnDestroy {
  chats: ChatRoom[] = [];
  isLoading = true;
  private sub!: Subscription;
  currentUserId?: string;

  constructor(private chatService: FirebaseChatService, private router: Router) {
    addIcons({ chatbubblesOutline, personCircle });
  }

  ngOnInit() {
    this.currentUserId = this.chatService.getCurrentUser()?.uid;
    this.sub = this.chatService.getMyChats().subscribe({
      next: (chats) => {
        this.chats = chats;
        this.isLoading = false;
      },
      error: (e) => {
        console.error("Erro ao puxar chats", e);
        this.isLoading = false;
      }
    });
  }

  ngOnDestroy() {
    if (this.sub) this.sub.unsubscribe();
  }

  // Identifica quem é a "outra pessoa" para mostrar foto/nome
  getOtherParticipant(chat: ChatRoom): ChatParticipant | undefined {
      return chat.participants.find(p => p.uid !== this.currentUserId);
  }

  openChat(chatId?: string) {
      if (chatId) {
          this.router.navigate(['/chat-details', chatId]);
      }
  }

  formatDate(timestamp: any): string {
    if (!timestamp || !timestamp.seconds) return '';
    const date = new Date(timestamp.seconds * 1000);
    const today = new Date();
    if (date.toDateString() === today.toDateString()) {
       return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString();
  }
}
