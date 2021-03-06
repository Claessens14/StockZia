var restify = require('restify');
var fs = require('fs');
var builder = require('botbuilder');
var botbuilder_azure = require("botbuilder-azure");
const AssistantV2 = require('ibm-watson/assistant/v2');
const { IamAuthenticator } = require('ibm-watson/auth');
require('dotenv').config();

var search = require('./search');
var chart = require('./chart');
var marketCard = require('./marketCard');
var analysis = require('./analysis');
var socialCard = require('./socialCard');
var format = require('./format');
var industriesJson = require('../assets/newData/spIndustry.json');

var users = {};
if (process.env.USER == "HOLD") {
  users = require('../assets/users.json');
}

var inMemoryStorage = new builder.MemoryBotStorage();
  
// Setup Restify Server
var server = restify.createServer();
server.listen(process.env.port || process.env.PORT || 3978, function () {
   console.log('%s listening to %s', server.name, server.url); 
});
  
// Create the watson assistant connector
const assistant = new AssistantV2({
  version: '2020-04-01', //found here   https://cloud.ibm.com/apidocs/assistant/assistant-v2?code=node#versioning
  authenticator: new IamAuthenticator({
    apikey: process.env.WATSON_ASSISTANT_V2_APIKEY,
  }),
  url: process.env.WATSON_ASSISTANT_V2_URL,
});

// Create chat connector for communicating with the Bot Framework Service
var thisBot = {
  openIdMetadata: process.env.BotOpenIdMetadata
}
if (process.env.BOT == "DEV") {
  thisBot["appId"] =  process.env.BOT_APP_ID_DEV;
  thisBot["appPassword"] = process.env.BOT_PASSWORD_DEV;
} else if (process.env.BOT == "FB") {
  thisBot["appId"] =  process.env.BOT_APP_ID_FB;
  thisBot["appPassword"] = process.env.BOT_PASSWORD_FB;
} else {
  console.log("ERROR : bot version was not decraled!");
  process.exit(1);
}
var connector = new builder.ChatConnector(thisBot);

// Listen for messages from users 
server.post('/api/messages', connector.listen());

// Create your bot with a function to receive messages from the user
var bot = new builder.UniversalBot(connector, function (session) {
  if (process.env.MESSAGE == "TRUE") console.log('________________________________\nMESSAGE : \n' + JSON.stringify(session.message, null, 2) + '\n________________________________\n');
  console.log("message recieved now ")
  session.sendTyping();

  var stockModes = ["Charts", "News", "Peers", /*"Earnings",*/ "Stats", "Financials", "About"];
  var payload = {
    //workspace_id: process.env.WATSON_WORKSPACE_ID,
    assistantId: process.env.WATSON_ASSISTANT_V2_ID,
    //sessionId: 'b624f50f-00b1-4377-80aa-440ce623e534',  //may need to create sessions
    context: getUser(session.message.user.name),    //should be no context value when program starts
    input: { text: session.message.text}
  };

   if (payload.context && payload.context.skills && payload.context.skills['main skill'] && payload.context.skills['main skill']['user_defined']) {
    if (payload.context.skills['main skill']['user_defined']['news']) {
      for (var i in payload.context.skills['main skill']['user_defined']['news']) {
        var el = payload.context.skills['main skill']['user_defined']['news'][i];
        if (payload.input.text == el.title) {
          if (el.type && el.type == "stock") {
            send(session, el.sum, null, stockModes);
          } else {
            send(session, el.sum);
          }
          return;
        }
      }
    } 
   }

   if (process.env.PAYLOAD == "TRUE") console.log('________________________________\nPRE CONVO PAYLOAD : \n' + JSON.stringify(payload, null, 2) + '\n________________________________\n');
   assistant.messageStateless(
    payload 
    )
    .then(response => {
    var watsonData = response.result; 
      //QUICK FIX -- adding user-defined action as output action so code doesnt need to be changed (8 changes needed)
    if (watsonData.output.user_defined && watsonData.output.user_defined.action) watsonData.output.action = watsonData.output.user_defined.action;
    if (!watsonData.context.skills['main skill']['user_defined']) watsonData.context.skills['main skill']['user_defined'] = {};  //avoid undefined error
    //if (watsonData.context.skills && watsonData.context.skills['main skill'] && watsonData.context.skills['main skill']['user_defined'])  watsonData.context

   if (process.env.WATSONDATA == "TRUE") console.log('________________________________\nWATSONDATA : \n' + JSON.stringify(watsonData, null, 2) + '\n________________________________\n');
      // if (err) {
      //    send(session, "Sorry but something went wrong");
      // } else {

      if (watsonData && watsonData && watsonData.output && watsonData.output.error) {
        console.log(watsonData.output.error);
        send(session, "Sorry but something went wrong");
        return;
      } 
      //SEND WATSON RESPONSE
      if (watsonData.output.generic /*&& watsonData.output.generic.text && watsonData.output.generic.text != "" */) {
         for (var output_text_obj of watsonData.output.generic) {
          if (output_text_obj.response_type == "text") {
            var buttons = (watsonData.output.action && watsonData.output.action.buttons) ? watsonData.output.action.buttons : null;
            send(session, output_text_obj.text, null, buttons);
          }
         }
        //make array sned
        console.log('________________________________\nWatson Data : \n' + JSON.stringify(watsonData.output, null, 2) + '\n________________________________\n')
        
      }

      ////SEND MARKET UPDATE!
      
      if (watsonData.output.hasOwnProperty('action')) {
        
        //TODO -- build single market cardout
        function buildSlip(str) {
            search.getMarketData(str, (err, data) => {
              if (process.env.MARKETDATA == "TRUE") console.log('________________________________\nSHOW CARD : \n' + JSON.stringify(data, null, 2) + '\n________________________________\n');
              if (err) {
                console.log("ERROR (searchMarket) there was an error in getting the market data" + err);
                send(session, "Sorry but something went wrong");
              } else {
                var card = marketCard.singleMarketCard(data);
                send(session, null, card);
                if (process.env.SHOWCARD == "TRUE") console.log('________________________________\nSHOW CARD : \n' + JSON.stringify(card, null, 2) + '\n________________________________\n');
              }
            });
        }
        if(watsonData.output.action == "showMarket") {
          var str = watsonData.entities[0].value;
          buildSlip(str);
        } else if(watsonData.output.action == "rollout") {
          search.getIndices((err, res) => {
            if (err) {
              send(session, "Oops something went wront");
              console.log(err);
            } else {
              var card = marketCard.multiMarketCard(res);
              send(session, null, card);

              //SEND MARKET NEWS
              search.getNews((err, results) => {
                //code for market goes here!
                var news = [];
                var cards = [];
                var array = results.articles;
                if (!watsonData.news) watsonData.news = [];
                for (var i = 0; i < array.length; i++) {
                  var headline = array[i].title;
                  var summary = array[i].description;
                  var url = array[i].url;

                  headline = format.checkStr(headline);
                  summary = format.checkStr(summary);
                  url = format.checkStr(url);
                  if (headline == null) headline = "";
                  if (summary == null) summary = "";
                  if (url == null) url = "";

                  if (headline != "") {
                    cards.push(marketCard.marketNews(session, array[i].url, array[i].title, array[i].description, array[i].urlToImage));      
                    var title = headline;
                    var sum = summary;
                    if (sum != "") {
                      news.push({"title" : title, "sum" : sum});
                    } else {
                      news.push({"title" : title, sum : "Sorry but there is no summary Availble"});
                    }
                  }
                }
                send(session, null, cards, null, null, true);
                if (!watsonData.context.skills['main skill']['user_defined']['news']) watsonData.context.skills['main skill']['user_defined']['news'] = [];
                var tempStr = watsonData.context.skills['main skill']['user_defined']['news'];
                watsonData.context.skills['main skill']['user_defined']['news'] = tempStr.concat(news);
              });
            }
          });
        }
      }

      if (watsonData.context.skills['main skill'] && watsonData.context.skills['main skill']['user_defined'] && watsonData.context.skills['main skill']['user_defined']['mode']) {
        //var stockModes = ["Charts", "News", "Peers", "Earnings", "Stats", "Financials"];
        if(watsonData.context.skills['main skill']['user_defined']['mode'] == "stock") {
          var str = getEntity(watsonData, "SP500");
          if (str == null || str == "") str = getEntity(watsonData, "iexStock");
          //var stock = {};
          function sendData(session, stock, action) {
            // stockModes = ["Charts", "Earnings", "Stats", "Financials", "News"];
            if (stock) {
              var card = {};
              if (action == "wantStats") {
                var msg = new builder.Message(session);
                card = socialCard.makeStatsCard(stock);
                send(session, null, card, stockModes);
              } else if (action == "wantEarnings") {
                // var msg = new builder.Message(session);
                // card = socialCard.makeEarningsCard(stock);
                // send(session, null, card, stockModes);
                var callStr = "For more insight on the stocks performace, checkout the conference call at " + 'https://earningscast.com/' + stock.company.symbol + '/2018';
                send(session, callStr, null, stockModes);
              } else if (action == "wantNews") {
                  var obj = socialCard.createNewsCards(session, stock);
                  if (obj && obj.cards && obj.news) {
                    send(session, null, obj.cards, stockModes, null, true);
                    if (!watsonData.context.skills['main skill']['user_defined']['mode']['news']) watsonData.context.skills['main skill']['user_defined']['mode']['news'] = [];
                    var tempStr = watsonData.context.skills['main skill']['user_defined']['mode']['news'];
                    watsonData.context.skills['main skill']['user_defined']['mode']['news'] = tempStr.concat(obj.news);
                  } else {
                    send(session, "Sorry but something went wrong while getting the news");
                  }
              } else if (action == "wantPeers") {
                // TODO -- Bug with IEX Data. The companies industries are different depend on if you make a 'stock query' or a 'batch stock query'
                var outputButtons = [];
                var industry = stock.company.industry;
                if (industriesJson && industriesJson[industry]) {
                  for (obj of industriesJson[industry]) {
                    outputButtons.push(obj.company.companyName)
                  }
                }
                (outputButtons.length > 0) ? send(session, "Here are some peers in the " + industry +  " industry", null, outputButtons) : send(session, "Sorry but I didn't find any industry peers")
                

                // var errMsg = "Sorry but I did not find any peers for this company";
                // if (stock.peers && stock.peers.length > 0) {
                //   search.getPeers(stock.peers, (err, res) =>  {
                //     if (err) {
                //       send(session, errMsg);
                //     } else {
                //       var cards = socialCard.makePeersCards(session, res);
                //       if (cards) {
                //         send(session, null, cards, stockModes, null, true)
                //       } else {
                //         send(session, errMsg);
                //       }
                //     }
                //   });
                // } else {
                //   send(session, errMsg);
                // }
              } else if (action == "wantDesc") {
                if (stock.company && stock.company.description && stock.company.description != "") {
                  send(session, stock.company.description);
                } else {
                  send(session, "Sorry but I countn't find a description");
                }
              } else if (action == "wantCharts") {
                var arr = ["Ok, let me draw it out", "Ok, I'll start drawing", "Let me get that chart for you", "Pulling up the chart now"];
                send(session, format.pickStr(arr));
                search.getVantageChart(stock.company.symbol , null, null, null, (err, res, change) => {
                  if (err) {
                      console.log(err)
                      send(session, "Sorry but I can't seem to retrieve that stock data", null, stockModes);
                    } else {
                      var companyName = stock.company.companyName.replace(/\(the\)/gi, "");
                      chart.grapher(stock, res.year, {"dp": "close", "title" : companyName, "length" : "1 Year"}, (err, yearUrl) => {
                        if (err) {
                          console.log(err)
                          send(session, "Sorry but I can't seem to build a graph", null, stockModes);
                        } else {
                          chart.grapher(stock, res.month, {"dp": "close", "title" : companyName, "length" : "3 Month"}, (err, monthUrl) => {
                            var cards = [socialCard.makeChartCard(session, stock, yearUrl, "1 Year (" + format.dataToStr(stock.stats.year1ChangePercent * 100) + "%)"), socialCard.makeChartCard(session, stock, monthUrl, "3 Month (" + format.dataToStr(stock.stats.month3ChangePercent * 100) + "%)")];
                            send(session, null, cards, stockModes, null, true);
                            //session.send(cards[0]);
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
              } else if (action == "wantAbout") {
                if (watsonData.context.skills['main skill']['user_defined']["stock"]) {
                  var stockJson = watsonData.context.skills['main skill']['user_defined']["stock"];
                  if (stockJson.company.description && (stockJson.company.description != "") && (stockJson.company.description != " ")) send(session, stockJson.company.description);
                }
              } else {
                console.log("ERROR (sendData) Does not know of this action : " + action);
              }
            }
            if (process.env.SHOWCARD == "TRUE") console.log('________________________________\nSHOW CARD : \n' + JSON.stringify(card, null, 2) + '\n________________________________\n');
          }
          //if a new search then show header
          if (str) {
            search.getStock(str, (err, stockJson) => {
              if (err) {
                console.log(err);
                send(session, "Sorry but I couldn't pull up that stocks information");
              } else {

                watsonData.context.skills['main skill']['user_defined']['lastStock'] = str;
                watsonData.context.skills['main skill']['user_defined']["stock"] = stockJson;
                  
                send(session, null, socialCard.makeHeaderCard(stockJson), stockModes);
                if (stockJson.company.description && (stockJson.company.description != "") && (stockJson.company.description != " ")) send(session, stockJson.company.description);

                if (watsonData.output.action) {
                  sendData(session, stockJson, watsonData.output.action);
                }                
                send(session, analysis.reviewStock(stockJson), null, stockModes);
              }
            });
          } else if (watsonData.context.skills['main skill']['user_defined']['lastStock'] && watsonData.output.action) {
            //if there is a stock to talk about and an action
            if (watsonData.output.action) {
              sendData(session, watsonData.context.skills['main skill']['user_defined']['stock'], watsonData.output.action);
            }
          }
        }
      }

      //if the anything else node is triggered, log it
      if (watsonData.output.hasOwnProperty('action') && watsonData.output.action === "logRequest") {
        fs.appendFile('./log/anythingElse.csv', session.message.user.name + ', ' +  session.message.text + '\n', function (err) {
          if (err) return console.log(err);
        });
      }

      //save user
      watsonData.context.skills['main skill']['user_defined']["user"] = session.message.address;

      putUser(session.message.user.name, watsonData.context);
      //}
   }).catch(err => {  //if error in watson assistant request
    console.log('ERROR:  ' + err);
  });;
}).set('storage', inMemoryStorage);;



/*array is for multiple strings
* obj is for a specific attachment
* buttons is for specific button
* top is for addition buttons to be add
* carousel is set true when in use */
function send(session, val, obj, buttons, top, carousel) {
  if (process.env.SEND) console.log("----------\nSEND: " + val + "-----\n" + JSON.stringify(obj, null, 2) + "----------\n");

  /*send the buttons..
  * if str is null then just send buttons
  * if str is set then send it with str, should be used for last one
  * if buttons is set then use it*/
  function sendModes(str) {
    //build mode buttons
    var modes = ["Quote", "Market", "Help!"];
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
      console.log("sent message")
    } else if (obj) {
      try {
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
          //send as single attachment
          var msg = new builder.Message(session)
          .addAttachment(obj)
          .suggestedActions(
            builder.SuggestedActions.create(
              session, objArray
            ));
          session.send(msg);
        }
      } catch (e) {
        console.log("ERROR (send) sending the object failed!!");
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
  //if string val or an array of strings
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
  //if object
  if (obj) {
    sendModes();
  }
  
  if (!(val || obj)) {
    console.log("ERROR (send) val and obj are null, not sending anything");
  }

}

/*pass in watson data and get out the entity value
TODO: passback the first entity if there is more than one found for the entity group*/
function getEntity(watsonData, entity) {
  if (watsonData.output.entities) {
    for (var i in watsonData.output.entities) {
      if (watsonData.output.entities[i].entity == entity) {
        return watsonData.output.entities[i].value;
      }
    }
    return null;
  }
}

function getUser(name) {
  if (users[name]) return users[name];
  return {}
}

function putUser(name, data) {
  users[name] = data;
  fs.writeFile('./assets/users.json', JSON.stringify(users, null, 2), function (err) {
    if (err) return console.log(err);
  });
}

// function setContext(watsonData_long_context) {
//   for (var )

//   return watsonData_long_context.context.skills['main skill']['user_defined'];
// }

// function fixContext(watsonData_short_context) {

// }

