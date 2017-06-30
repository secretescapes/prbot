deploy:
	git add .
	git commit -m'something'
	git push
	git push heroku master
	heroku logs -t
