import { Component, OnInit, OnDestroy, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { IonContent, IonHeader, IonTitle, IonToolbar, IonButtons, IonBackButton, IonFooter, IonInput, IonButton, IonIcon, IonAvatar, IonSpinner } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { send, personCircle } from 'ionicons/icons';
import { Subscription } from 'rxjs';
import { FirebaseChatService } from '../../services/firebase-chat.service';
import { ChatRoom, ChatMessage, ChatParticipant } from '../../interfaces/chat';

@Component({
  selector: 'app-chat-details',
  templateUrl: './chat-details.page.html',
  styleUrls: ['./chat-details.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonContent, IonHeader, IonTitle, IonToolbar, IonButtons, IonBackButton, IonFooter, IonInput, IonButton, IonIcon, IonAvatar, IonSpinner]
})
export class ChatDetailsPage implements OnInit, OnDestroy {
  @ViewChild(IonContent, { static: false }) content!: IonContent;
  
  chatId: string = '';
  chatRoom?: ChatRoom;
  messages: ChatMessage[] = [];
  newMessage: string = '';
  
  currentUserId?: string;
  otherParticipant?: ChatParticipant;
  
  isLoading = true;
  private sub!: Subscription;

  constructor(
    private route: ActivatedRoute,
    private chatService: FirebaseChatService
  ) {
    addIcons({ send, personCircle });
  }

  async ngOnInit() {
    this.currentUserId = this.chatService.getCurrentUser()?.uid;
    this.chatId = this.route.snapshot.paramMap.get('id') || '';

    if (this.chatId) {
       this.chatRoom = await this.chatService.getChatDetails(this.chatId);
       if (this.chatRoom) {
          this.otherParticipant = this.chatRoom.participants.find(p => p.uid !== this.currentUserId);
       }
       
       this.sub = this.chatService.getMessages(this.chatId).subscribe({
           next: (msgs) => {
               this.messages = msgs;
               this.isLoading = false;
               setTimeout(() => this.scrollToBottom(), 150);
           },
           error: (e) => {
               console.error("Error reading messages", e);
               this.isLoading = false;
           }
       });
    }
  }

  ngOnDestroy() {
    if (this.sub) this.sub.unsubscribe();
  }

  async sendMessage() {
    if (!this.newMessage.trim()) return;
    const text = this.newMessage.trim();
    this.newMessage = ''; // optimistic clear
    
    try {
      await this.chatService.sendMessage(this.chatId, text);
      this.scrollToBottom();
    } catch(e) {
      console.error("Failed to send message", e);
      // Optional: Give UI feedback on error. Restore string.
      this.newMessage = text;
    }
  }

  scrollToBottom() {
    if (this.content) {
      this.content.scrollToBottom(300);
    }
  }

  formatTime(timestamp: any): string {
    if(!timestamp || !timestamp.seconds) return '';
    const d = new Date(timestamp.seconds * 1000);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
}
