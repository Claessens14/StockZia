var restify = require('restify');
var fs = require('fs');
var builder = require('botbuilder');
var botbuilder_azure = require("botbuilder-azure");
var Conversation = require('watson-developer-cloud/conversation/v1'); // watson sdk
require('dotenv').config();

var search = require('./search');
var chart = require('./chart');
var softOut = require('./softOut');
var analysis = require('./analysis');
var socialCard = require('./socialCard');
var portfolio = require('./portfolio');
var format = require('./format');

//var users = require('../assets/users.json');

var users = require('../assets/users.json');

//declare global vars
var workspace=process.env.WATSON_WORKSPACE_ID;

// Setup Restify Server
var server = restify.createServer();
server.listen(process.env.port || process.env.PORT || 3978, function () {
   console.log('%s listening to %s', server.name, server.url); 
});
  
// Create the service wrapper
var conversation = new Conversation({
   username: process.env.WATSON_USERNAME,
   password: process.env.WATSON_PASSWORD,
   url: 'https://gateway.watsonplatform.net/conversation/api',  //idk what this is for
   version_date: Conversation.VERSION_DATE_2017_04_21
});

// Create chat connector for communicating with the Bot Framework Service
var connector = new builder.ChatConnector({
    appId: process.env.BOT_APP_ID,
    appPassword: process.env.BOT_PASSWORD,
    openIdMetadata: process.env.BotOpenIdMetadata
});

// Listen for messages from users 
server.post('/api/messages', connector.listen());



/*----------------------------------------------------------------------------------------
* Bot Storage: This is a great spot to register the private state storage for your bot. 
* We provide adapters for Azure Table, CosmosDb, SQL Azure, or you can implement your own!
* For samples and documentation, see: https://github.com/Microsoft/BotBuilder-Azure
* ---------------------------------------------------------------------------------------- */

// var tableName = 'botdata';
// var azureTableClient = new botbuilder_azure.AzureTableClient(tableName, process.env['AzureWebJobsStorage']);
// var tableStorage = new botbuilder_azure.AzureBotStorage({ gzipData: false }, azureTableClient);

// Create your bot with a function to receive messages from the user
var bot = new builder.UniversalBot(connector, function (session) {
  if (process.env.MESSAGE == "TRUE") console.log('________________________________\nMESSAGE : \n' + JSON.stringify(session.message, null, 2) + '\n________________________________\n');;

  session.sendTyping();

  //before sending to watson..
  session.message.text = session.message.text.replace(/^#/, "teach me about ");

   var payload = {
      workspace_id: workspace,
      context: getUser(session.message.user.name),    //should be no context value when program starts
      input: { text: session.message.text}
   };

   if (process.env.PAYLOAD == "TRUE") console.log('________________________________\nPRE CONVO PAYLOAD : \n' + JSON.stringify(payload, null, 2) + '\n________________________________\n');
   conversation.message(payload, function(err, watsonData) {
      if (process.env.WATSONDATA == "TRUE") console.log('________________________________\nWATSONDATA : \n' + JSON.stringify(watsonData, null, 2) + '\n________________________________\n');
      if (err) {
         session.send(err);
      } else {

      if (watsonData.output.text && watsonData.output.text != "") {
         send(session, watsonData.output.text);
      }

      //show marketData!
      if (watsonData.output.hasOwnProperty('action')) {
        function searchMarket(str) {
            search.getMarketData(str, (err, data) => {
              if (process.env.MARKETDATA == "TRUE") console.log('________________________________\nSHOW CARD : \n' + JSON.stringify(data, null, 2) + '\n________________________________\n');
              if (err) {
                console.log("ERROR (searchMarket) there was an error in getting the market data" + err);
                send(session, "Sorry but something went wrong");
              } else {
                var card = softOut.singleMarketCard(data);
                send(session, null, card);
                if (process.env.SHOWCARD == "TRUE") console.log('________________________________\nSHOW CARD : \n' + JSON.stringify(card, null, 2) + '\n________________________________\n');
              }
            });
        }
        //send market data!
        if(watsonData.output.action == "showMarket") {
          var str = watsonData.entities[0].value;
          searchMarket(str);
        } else if(watsonData.output.action == "rollout") {
          searchMarket("DJI");
          searchMarket("GSPC");
          searchMarket("IXIC");
        }
      }



//       var msg = new builder.Message(session);
//     msg.attachmentLayout(builder.AttachmentLayout.carousel)
//     msg.attachments([
//         new builder.HeroCard(session)
//             .title("Classic White T-Shirt")
//             .subtitle("100% Soft and Luxurious Cotton")
//             .text("Price is $25 and carried in sizes (S, M, L, and XL)")
//             .images([builder.CardImage.create(session, "https://www.stocktrader.com/wp-content/uploads/2007/10/goog-102907.png")])
//             .buttons([
//                 builder.CardAction.openUrl(session, "https://www.stocktrader.com/wp-content/uploads/2007/10/goog-102907.png", "Enlarge")
//             ])
//     ]);

// session.send(msg);

      if (watsonData.context.hasOwnProperty('mode')) {
        var stockModes = ["add to watchlist", "charts", "earnings", "ratios", "financials", "news"];
        if(watsonData.context.mode == "stock") {
          var str = getEntity(watsonData, "SP500")
          var stock = {};
          //if a new search then show header
          if (str) {
            search.getStock(str, (err, stockJson) => {
              if (err) {
                console.log(err);
              } else {

                watsonData.context.lastStock = str;
                watsonData.context["stock"] = stockJson;

                if ((session.message.address.channelId === "webchat") || (session.message.address.channelId === "emulator")) {
                  var msg = new builder.Message(session)
                    .addAttachment(softOut.buildStockCard(stockJson));
                  send(session, analysis.reviewStock(stockJson), msg, stockModes);
                } else {
                  
                  send(session, null, socialCard.makeHeaderCard(stockJson), stockModes);
                  if (stockJson.company.description && (stockJson.company.description != "") && (stockJson.company.description != " ")) send(session, stockJson.company.description);

                  if (watsonData.output.action) {
                    sendData(session, stockJson, watsonData.output.action);
                  }                
                  send(session, analysis.reviewStock(stockJson), null, stockModes);
                }
              }
            });
          } else if (watsonData.context.lastStock && watsonData.output.action) {
            //if there is a stock to talk about and an action
            if (watsonData.output.action) {
              sendData(session, watsonData.context.stock, watsonData.output.action);
              // var temp = updatePortfolio(session, watsonData, watsonData.output.action);
              // watsonData.context.portfolio = {};
              // watsonData.context.portfolio = temp;
            }
          }
        }
      }

      //show portfolio
      if (watsonData.output.hasOwnProperty('action') && watsonData.output.action === "showPortfolio") {
        session.send("Stock \\n hey");
      }

      //if the anything else node is triggered, log it
      if (watsonData.output.hasOwnProperty('action') && watsonData.output.action === "logRequest") {
        fs.appendFile('./log/anythingElse.csv', session.message.user.name + ', ' +  session.message.text + '\n', function (err) {
          if (err) return console.log(err);
        });
      }

      //save user
      watsonData.context["user"] = session.message.address;
      putUser(session.message.user.name, watsonData.context);
      }
   });

});

function sendData(session, stock, action) {
  var stockModes = ["add to wishlist", "charts", "earnings", "ratios", "financials", "news"];
  if (stock) {
    var card = {};
    if (action == "wantStats") {
      var msg = new builder.Message(session);
      card = socialCard.makeStatsCard(stock);
      send(session, null, card, stockModes);
    } else if (action == "wantEarnings") {
      var msg = new builder.Message(session);
      card = socialCard.makeEarningsCard(stock);
      send(session, null, card, stockModes);
    } else if (action == "wantNews") {
        var cards = socialCard.createNewsCards(session, stock);
        send(session, null, cards, stockModes, null, true);
    } else if (action == "wantChart") {
        search.getVantageChart(stock.company.symbol , null, null, null, (err, res, change) => {
          if (err) {
              console.log(err)
              send(session, "Sorry but I can't seem to retrieve that stock data", null, stockModes);
            } else {

              chart.grapher(stock, res.year, {"dp": "close", "title" : stock.company.companyName, "length" : "1 Year"}, (err, yearUrl) => {
                if (err) {
                  console.log(err)
                  send(session, "Sorry but I can't seem to build a graph", null, stockModes);
                } else {
                  chart.grapher(stock, res.month, {"dp": "close", "title" : stock.company.companyName, "length" : "3 Month"}, (err, monthUrl) => {
                    var cards = [socialCard.makeChartCard(session, stock, yearUrl, "1 Year (" + format.dataToStr(stock.stats.year1ChangePercent * 100) + "%)"), socialCard.makeChartCard(session, stock, monthUrl, "3 Month (" + format.dataToStr(stock.stats.month3ChangePercent * 100) + "%)")];
                    send(session, null, cards, stockModes, null, true);
                  });
                }
              });
            }
        })
    } else if (action == "wantFin") {
      var msg = new builder.Message(session);
      card = socialCard.makeFinCard(stock)
      send(session, null, card, stockModes);
      var callStr = "For more insight on the stocks performace, checkout the conference call at " + 'https://earningscast.com/' + stock.company.symbol + '/2018';
      send(session, callStr, null, stockModes);
    } else {
      console.log("ERROR (sendData) Does not know of this action : " + action);
    }
  }
  if (process.env.SHOWCARD == "TRUE") console.log('________________________________\nSHOW CARD : \n' + JSON.stringify(card, null, 2) + '\n________________________________\n');
}

/*array is for multiple strings
* obj is for a specific attachment
* buttons is for specific button
* top is for addition buttons to be add
* carousel is set true when in use
*/
function send(session, val, obj, buttons, top, carousel) {
  console.log("----------\nSEND: " + val + "-----\n" + obj + "----------\n");
  /*send the buttons..
  * if str is null then just send buttons
  * if str is set then send it with str, should be used for last one
  * if buttons is set then use it*/
  function sendModes(str) {
    //build mode buttons
    var modes = ["quote", "educate", "market", "watchlist", "help"];
    if ((buttons && buttons[0]) && top) {
      modes = buttons.concat(modes);
    } else if (buttons && buttons[0]) {
      modes = buttons;
    }
    var objArray = [];
    modes.forEach(function(el) {
      objArray.push(builder.CardAction.imBack(session, el, el));
    });

    //send to user
    if (str) {
      var msg = new builder.Message(session)
        .text(str)
        .suggestedActions(
          builder.SuggestedActions.create(
            session, objArray
          ));
      session.send(msg);
    } else if (obj) {
      //an object is being send
      if (carousel) {
        var reply = new builder.Message(session)
          .attachmentLayout(builder.AttachmentLayout.carousel)
          .attachments(obj)
          .suggestedActions(
            builder.SuggestedActions.create(
              session, objArray
            ));
        session.send(reply);
      } else {
        var msg = new builder.Message(session)
        .addAttachment(obj)
        .suggestedActions(
          builder.SuggestedActions.create(
            session, objArray
          ));
        session.send(msg);
      }
    } else {
      //just send the modes
      var msg = new builder.Message(session)
        .text("")
        .suggestedActions(
          builder.SuggestedActions.create(
            session, objArray
          ));
      session.send(msg);
    }
  }


  if (val) {
    if (typeof val == "string") {
      sendModes(val)
    } else {
      var stop = val.length - 1;
      for (var i = 0; i < stop; i++) {
        session.send(val[i].replace(/  /g, " "));
      }
      sendModes(val[i].replace(/  /g, " "));
    }  
  } 
  if (obj) {
    sendModes();
  }
  
  if (!(val || obj)) {
    console.log("ERROR (send) val and obj are null, not sending anything");
  }

}


 function getEntity(watsonData, entity) {
  if (watsonData.entities) {
    for (var i in watsonData.entities) {
      if (watsonData.entities[i].entity == entity) {
        return watsonData.entities[i].value;
      }
    }
    return null;
  }
}

function getUser(name) {
  return users[name]
}

function putUser(name, data) {
  users[name] = data;
  fs.writeFile('./assets/users.json', JSON.stringify(users, null, 2), function (err) {
    if (err) return console.log(err);
  });
}


//bot.set('storage', tableStorage);
