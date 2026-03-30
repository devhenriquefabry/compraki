import { Component, OnInit } from '@angular/core';
import { User } from '../../interfaces/user'
import { Notifications } from 'src/app/interfaces/notifications';
import { Product } from 'src/app/interfaces/product';

@Component({
  selector: 'app-my-account',
  templateUrl: './my-account.page.html',
  styleUrls: ['./my-account.page.scss'],
  standalone: false
})
export class MyAccountPage implements OnInit {

  public pocoF5 : Product = {
    name : 'Pocofone F5',
    price : 990.00,
    isUsed : false,
    paymentMethod: 'CARTÃO'
  }

  public pocoF5UsadoDoiVendido : Notifications = {
    body : 'Parabens, seu Pocophone F5 foi vendido com sucesso!',
    header: 'ITEM VENDIDO COM SUCESSO!',
    product: this.pocoF5
  }

  public familiaSantos: User[] = [
  
  {
    email: 'henriquefabry2003@gmail.com',
    name: 'Henrique Santos',
    born: '15 de Julho de 2003',
    profile_image_url: 'https://lh3.googleusercontent.com/ogw/AF2bZyjl1AlRTr1wpk7UtTnqdbjNqOQjfVHWfGJyN6YPz9OoZtTI=s64-c-mo'
  },{
    email: 'laurinha@gmail.com',
    name: 'Laura Luisa',
    born: '12 de Janeiro de 2010',
    profile_image_url: ''
  }



]
  constructor() { }

  ngOnInit() {
  }

}
