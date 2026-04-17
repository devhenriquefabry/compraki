import { Component, OnInit, OnDestroy, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { IonContent, IonHeader, IonTitle, IonToolbar, IonList, IonItem, IonAvatar, IonLabel, IonNote, IonSpinner, IonIcon, IonFab, IonFabButton, IonModal, IonButtons, IonButton } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { chatbubblesOutline, personCircle, add, close } from 'ionicons/icons';
import { Subscription } from 'rxjs';
import { FirebaseChatService } from '../../services/firebase-chat.service';
import { FirebaseUsersService } from '../../services/firebase-users.service';
import { ChatRoom, ChatParticipant } from '../../interfaces/chat';
import { AppUser } from '../../interfaces/app-user';
import { MiniHeaderComponent } from '../../components/mini-header/mini-header.component';

@Component({
  selector: 'app-chats',
  templateUrl: './chats.page.html',
  styleUrls: ['./chats.page.scss'],
  standalone: true,
  imports: [CommonModule, IonContent, IonHeader, IonTitle, IonToolbar, IonList, IonItem, IonAvatar, IonLabel, IonNote, IonSpinner, IonIcon, IonFab, IonFabButton, IonModal, IonButtons, IonButton, MiniHeaderComponent]
})
export class ChatsPage implements OnInit, OnDestroy {
  @ViewChild('newChatModal') newChatModal!: IonModal;
  
  chats: ChatRoom[] = [];
  isLoading = true;
  private sub!: Subscription;
  currentUserId?: string;

  globalUsers: AppUser[] = [];
  modalLoading = true;
  private usersSub!: Subscription;

  constructor(
    private chatService: FirebaseChatService, 
    private usersService: FirebaseUsersService,
    private router: Router
  ) {
    addIcons({ chatbubblesOutline, personCircle, add, close });
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

    // Fetches all users for the new chat modal
    this.usersSub = this.usersService.getAllUsers().subscribe({
      next: (users) => {
        // Filter out the current user so they don't chat with themselves
        this.globalUsers = users.filter(u => u.uid !== this.currentUserId);
        this.modalLoading = false;
      },
      error: (e) => {
        console.error("Erro ao carregar usuários:", e);
        this.modalLoading = false;
      }
    });
  }

  ngOnDestroy() {
    if (this.sub) this.sub.unsubscribe();
    if (this.usersSub) this.usersSub.unsubscribe();
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

  async startNewChatWith(user: AppUser) {
    if (this.newChatModal) {
      this.newChatModal.dismiss();
    }
    
    try {
      const otherParticipant: ChatParticipant = {
        uid: user.uid,
        name: user.displayName || 'Usuário',
        photoUrl: user.photoURL || undefined
      };
      const chatId = await this.chatService.startChat(otherParticipant);
      this.router.navigate(['/chat-details', chatId]);
    } catch (e) {
      console.error("Erro ao iniciar novo chat: ", e);
      alert('Não foi possível iniciar o chat.');
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
