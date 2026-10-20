import { Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { IonContent, NavController } from '@ionic/angular/standalone';
import { ChatBoxComponent } from '../../components/chat-box/chat-box.component';
import { LayoutService } from '../../core/layout.service';

/**
 * Uma conversa em tela cheia (celular e app). No desktop a conversa mora no
 * painel de Mensagens: esta rota só repassa para `/tabs/chats?c=<id>` — é o
 * link que os avisos e o push usam.
 */
@Component({
  selector: 'app-chat-details',
  templateUrl: './chat-details.page.html',
  styleUrls: ['./chat-details.page.scss'],
  standalone: true,
  imports: [IonContent, ChatBoxComponent]
})
export class ChatDetailsPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly navCtrl = inject(NavController);
  private readonly layout = inject(LayoutService);

  chatId = '';

  ngOnInit() {
    this.chatId = this.route.snapshot.paramMap.get('id') || '';
    if (this.chatId && this.layout.isDesktop()) {
      void this.router.navigate(['/tabs/chats'], { queryParams: { c: this.chatId }, replaceUrl: true });
    }
  }

  back() {
    if (window.history.length > 1) this.navCtrl.back();
    else this.navCtrl.navigateRoot('/tabs/chats');
  }
}
